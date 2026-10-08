import { ipcRenderer } from 'electron';
import { IPC } from '../shared/constants/ipc';
import { readPlayback, findMedia } from './integration/detector';
import { readSiteState } from './integration/site-state';
import { NativeLyrics } from './integration/native-lyrics';
import { emptyPlayback } from '../shared/types/playback-state';
import type { PanelData } from '../shared/types/ui';
import { executePlayerCommand } from './integration/controller';
import type { PlayerCommand } from '../shared/types/music';
import { VolumeController, type VolumePreference } from './integration/volume';
import { selectors } from './integration/selectors';
import { AudioGainController } from './integration/audio-gain';
import { audioGainRequestSchema } from '../shared/types/crossfade';
import { PlaybackAdBlocker } from './integration/playback-ad-blocker';

if (location.origin === 'https://music.youtube.com') {
  const playbackAds = new PlaybackAdBlocker();
  const audio = new AudioGainController(() => ipcRenderer.send(IPC.crossfadeCancel, 'ended'));
  let audioOperation = Promise.resolve();
  ipcRenderer.on(IPC.audioGain, (_event, input: unknown) => {
    const parsed = audioGainRequestSchema.safeParse(input);
    if (!parsed.success) return;
    const request = parsed.data;
    audioOperation = audioOperation.then(async () => {
      try {
        const status = await audio.command(request);
        ipcRenderer.send(IPC.audioGainReply, { id: request.id, ok: true, status });
      } catch (error) {
        audio.reset();
        ipcRenderer.send(IPC.audioGainReply, {
          id: request.id,
          ok: false,
          error: String(error).slice(0, 500),
        });
      }
    });
  });
  const cancelCrossfade = (event: Event) => {
    if (!audio.fading || !event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        '.volume, [class*="Volume"], [aria-label*="olume"], #volume-slider, #ytmusic-plus-volume-percent',
      )
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      ![
        ' ',
        'k',
        'j',
        'l',
        'ArrowLeft',
        'ArrowRight',
        'MediaPlayPause',
        'MediaNextTrack',
        'MediaPreviousTrack',
      ].includes(event.key)
    )
      return;
    if (
      event.type === 'click' &&
      !target?.closest(
        'button, yt-icon-button, input[type="range"], ytmusic-player-queue-item, ytmusic-player-queue-item-renderer',
      )
    )
      return;
    audio.reset();
    ipcRenderer.send(IPC.crossfadeCancel, 'user');
  };
  document.addEventListener('click', cancelCrossfade, true);
  document.addEventListener('keydown', cancelCrossfade, true);
  let lastSnapshot = '';
  let lastPosition = 0;
  let boundVideo: HTMLMediaElement | null = null;
  let state = emptyPlayback();
  let received = performance.now();
  let publishing = false;
  let lastAccount = 'unknown';
  const lyrics = new NativeLyrics(() => ({ state, received }));
  let volumeSave: ReturnType<typeof setTimeout> | undefined;
  let pendingVolume: VolumePreference | undefined;
  const saveVolume = () => {
    if (pendingVolume) ipcRenderer.send(IPC.volumePreference, pendingVolume);
    pendingVolume = undefined;
  };
  const volume = new VolumeController((preference) => {
    pendingVolume = preference;
    clearTimeout(volumeSave);
    volumeSave = setTimeout(saveVolume, 150);
  });
  ipcRenderer.on(IPC.musicVolume, (_event, preference: VolumePreference) =>
    volume.receive(preference),
  );
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePublish = () => {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      void publish();
    }, 100);
  };
  const observer = new MutationObserver(schedulePublish);
  let observedPlayer: Element | null = null;
  const publish = async () => {
    if (publishing) return;
    publishing = true;
    try {
      const site = await readSiteState().catch(() => undefined);
      state = readPlayback(site);
      received = performance.now();
      if (site?.account && site.account !== lastAccount) {
        lastAccount = site.account;
        ipcRenderer.send(IPC.accountState, site.account);
      }
      const serialized = JSON.stringify(state);
      if (serialized === lastSnapshot) return;
      lastSnapshot = serialized;
      lastPosition = Date.now();
      ipcRenderer.send(IPC.musicState, state);
    } catch (error) {
      console.error('YTMusic+ playback detection:', String(error));
    } finally {
      publishing = false;
    }
  };
  const mediaEvents = [
    'play',
    'pause',
    'ended',
    'durationchange',
    'volumechange',
    'seeked',
    'loadedmetadata',
  ];
  const discover = () => {
    void playbackAds.report().catch(() => {});
    volume.discover();
    const player = document.querySelector(selectors.player);
    if (player !== observedPlayer) {
      observer.disconnect();
      if (player)
        observer.observe(player, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['title', 'aria-pressed', 'src'],
        });
      observedPlayer = player;
    }
    const video = findMedia();
    if (video !== boundVideo) {
      for (const event of mediaEvents) boundVideo?.removeEventListener(event, schedulePublish);
      boundVideo = video;
      for (const event of mediaEvents) video?.addEventListener(event, schedulePublish);
    }
    lyrics.discover();
    if (Date.now() - lastPosition >= 950) void publish();
  };
  const timer = setInterval(discover, 1000);
  document.addEventListener('yt-navigate-finish', publish);
  ipcRenderer.on(
    IPC.playerCommand,
    async (_event, request: { id: string; command: PlayerCommand }) => {
      try {
        if (request.command.type === 'setVolume')
          await volume.command({ type: 'setVolume', value: request.command.value });
        else if (request.command.type === 'toggleMute')
          await volume.command({ type: 'toggleMute' });
        else await executePlayerCommand(request.command);
        ipcRenderer.send(IPC.playerResult, { id: request.id, ok: true });
        await publish();
      } catch (error) {
        ipcRenderer.send(IPC.playerResult, { id: request.id, ok: false, error: String(error) });
      }
    },
  );
  const style = document.createElement('style');
  style.id = 'ytmusic-plus-appearance';
  ipcRenderer.on(IPC.musicStyle, (_event, css: string) => {
    if (!style.isConnected) document.documentElement.append(style);
    style.textContent = css;
  });
  ipcRenderer.on(IPC.nativeLyrics, (_event, value: { panel: PanelData | null; open: boolean }) =>
    lyrics.update(value.panel, value.open),
  );
  // beforeunload also fires for navigation that the app intercepts (sign-in,
  // external links) or the user cancels. The current document remains usable.
  window.addEventListener('pagehide', (event) => {
    clearTimeout(volumeSave);
    saveVolume();
    if (event.persisted) return;
    clearInterval(timer);
    clearTimeout(publishTimer);
    observer.disconnect();
    lyrics.dispose();
    volume.dispose();
    audio.dispose();
    playbackAds.dispose();
    document.removeEventListener('click', cancelCrossfade, true);
    document.removeEventListener('keydown', cancelCrossfade, true);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) discover();
  });
}
