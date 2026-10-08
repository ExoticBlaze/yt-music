import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';
import { IPC } from '../../shared/constants/ipc';
import { playbackSchema, emptyPlayback, type PlaybackState } from '../../shared/types/music';
import type { CrossfadeConfig, CrossfadeStatus } from '../../shared/types/crossfade';
import type { VolumePreference } from '../../preload/integration/volume';
import type { MusicContext } from './context';
import { PlayerService } from './player-service';
import { AudioGainClient } from './audio-gain-client';
import { CrossfadeEngine, type FadeDeck } from './crossfade-engine';

const playerReply = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().max(1000).optional(),
});

export class CrossfadeService {
  readonly engine: CrossfadeEngine;
  private audio: AudioGainClient;
  private timer: NodeJS.Timeout;
  private owner?: string;
  private configuredBy?: string;
  private unsubscribe: () => void;
  private windows = new Map<BrowserWindow, { close: () => void; ready: boolean }>();
  constructor(
    private root: string,
    private contents: WebContents,
    private player: PlayerService,
    music: MusicContext,
    private preference: () => VolumePreference,
  ) {
    this.audio = new AudioGainClient(contents);
    this.engine = new CrossfadeEngine({
      state: () => music.getState(),
      primary: {
        read: () => this.audio.command(),
        gain: async (gain, seconds = 0, curve = 'in') => {
          await this.audio.command({ gain, seconds, curve });
        },
      },
      prepare: (id, seconds) => this.prepare(id, seconds),
      next: () => player.command({ type: 'next' }, 'crossfade'),
    });
    this.timer = setInterval(() => {
      void this.engine.tick();
    }, 200);
    this.unsubscribe = music.on('stateChanged', (state) => {
      const phase = this.engine.status().phase;
      if (
        ['preparing', 'ready'].includes(phase) &&
        ((!state.playing && !state.buffering) || state.ad || state.repeat === 'one')
      )
        this.cancel(true);
    });
    ipcMain.on(IPC.crossfadeCancel, this.intent);
    contents.on('did-start-navigation', this.navigation);
    contents.on('render-process-gone', this.failed);
    player.onCommand = (command, origin) => {
      if (
        origin === 'user' &&
        [
          'pause',
          'togglePlay',
          'seek',
          'next',
          'previous',
          'openTrack',
          'playQueueItem',
          'setRate',
          'cycleRepeat',
        ].includes(command.type)
      )
        this.cancel(true);
    };
  }
  private trusted(event: IpcMainEvent, contents: WebContents): boolean {
    return (
      !contents.isDestroyed() &&
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame.url.startsWith('https://music.youtube.com/')
    );
  }
  private intent = (event: IpcMainEvent, reason: unknown): void => {
    if (!['user', 'ended'].includes(String(reason))) return;
    if (
      this.trusted(event, this.contents) ||
      [...this.windows.keys()].some((window) => this.trusted(event, window.webContents))
    )
      this.cancel(reason === 'user');
  };
  private navigation = (
    _event: Electron.Event,
    _url: string,
    inPlace: boolean,
    mainFrame: boolean,
  ): void => {
    if (mainFrame && !inPlace) this.cancel(true);
  };
  private failed = (): void => this.cancel();
  private cancel(retry = false): void {
    this.engine.cancel(undefined, retry);
    for (const entry of this.windows.values()) if (!entry.ready) entry.close();
  }
  status(id: string): CrossfadeStatus {
    return this.owner === id || (!this.owner && this.configuredBy === id)
      ? this.engine.status()
      : { enabled: false, seconds: 5, phase: 'off' };
  }
  configure(id: string, value: CrossfadeConfig): CrossfadeStatus {
    if (value.enabled && this.owner && this.owner !== id)
      throw new Error('Another plugin is already controlling crossfade');
    if (this.owner && this.owner !== id) return this.status(id);
    this.cancel();
    this.owner = value.enabled ? id : undefined;
    this.configuredBy = id;
    return this.engine.configure(value);
  }
  remove(id: string): void {
    if (this.owner === id)
      this.configure(id, { enabled: false, seconds: this.engine.status().seconds });
  }
  volume(): void {
    for (const window of this.windows.keys())
      if (!window.isDestroyed()) window.webContents.send(IPC.musicVolume, this.preference());
  }
  private async prepare(videoId: string, seconds: number): Promise<FadeDeck> {
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        preload: join(this.root, 'preload/music.cjs'),
        session: this.contents.session,
        offscreen: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setUserAgent(this.contents.getUserAgent());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    const allowMusic = (event: Electron.Event, url: string) => {
      try {
        if (new URL(url).origin === 'https://music.youtube.com') return;
      } catch {
        /* Deny invalid URLs. */
      }
      event.preventDefault();
    };
    contents.on('will-navigate', allowMusic);
    contents.on('will-redirect', allowMusic);
    let state: PlaybackState = emptyPlayback();
    const audio = new AudioGainClient(contents);
    const player = new PlayerService(contents);
    const result = (event: IpcMainEvent, input: unknown) => {
      if (!this.trusted(event, contents)) return;
      const parsed = playerReply.safeParse(input);
      if (parsed.success) player.result(parsed.data);
    };
    const snapshot = (event: IpcMainEvent, input: unknown) => {
      if (!this.trusted(event, contents)) return;
      const parsed = playbackSchema.safeParse(input);
      if (parsed.success) state = parsed.data;
    };
    ipcMain.on(IPC.playerResult, result);
    ipcMain.on(IPC.musicState, snapshot);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.windows.delete(window);
      ipcMain.removeListener(IPC.playerResult, result);
      ipcMain.removeListener(IPC.musicState, snapshot);
      player.dispose();
      audio.dispose();
      if (!window.isDestroyed()) window.destroy();
    };
    const entry = { close, ready: false };
    this.windows.set(window, entry);
    contents.on('render-process-gone', () => {
      close();
      this.engine.cancel('Crossfade player stopped. Normal playback continues.');
    });
    contents.on('did-finish-load', () => contents.send(IPC.musicVolume, this.preference()));
    const deck: FadeDeck = {
      read: () => audio.command(),
      gain: async (gain, duration = 0, curve = 'in') => {
        await audio.command({ gain, seconds: duration, curve, secondary: true });
      },
      seek: (position) => player.command({ type: 'seek', value: position }),
      play: async () => {
        await player.command({ type: 'play' });
        const deadline = Date.now() + 1800;
        while (!closed && Date.now() < deadline) {
          const status = await audio.command();
          if (status.playing && status.ready) {
            contents.setAudioMuted(this.contents.isAudioMuted());
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('The outgoing song could not start in time.');
      },
      close,
    };
    try {
      // Only the official player loads the song. No stream URLs, decoding,
      // downloading, credential copying or DRM handling is exposed to plugins.
      await window.loadURL(`https://music.youtube.com/watch?v=${videoId}`);
      const deadline = Date.now() + 20000;
      while (!closed && Date.now() < deadline) {
        if (state.track?.videoId === videoId && state.track.duration > 0 && !state.ad) {
          const status = await audio.command({ gain: 0, secondary: true });
          if (status.supported && status.ready) {
            await player.command({ type: 'pause' });
            await deck.seek(Math.max(0, status.duration - seconds - 3));
            entry.ready = true;
            return deck;
          }
          if (!status.supported && status.reason?.includes('cannot'))
            throw new Error(status.reason);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(
        closed ? 'Crossfade cancelled.' : 'The outgoing song could not be buffered in time.',
      );
    } catch (error) {
      close();
      throw error;
    }
  }
  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
    this.cancel();
    for (const entry of this.windows.values()) entry.close();
    ipcMain.removeListener(IPC.crossfadeCancel, this.intent);
    this.contents.removeListener('did-start-navigation', this.navigation);
    this.contents.removeListener('render-process-gone', this.failed);
    this.player.onCommand = undefined;
    this.audio.dispose();
  }
}
