import { app, clipboard } from 'electron';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { MusicContext } from '../../src/main/music/context';
import type { PluginHost } from '../../src/main/plugins/plugin-host';
import type { OverlayRegistry } from '../../src/main/plugins/overlay-registry';
import type { UINode } from '../../src/shared/types/ui';
import type { PlayerCommand } from '../../src/shared/types/music';
import { parseRoomInvite } from '../../src/shared/types/room-invite';

const pluginId = 'listen-together';
const firstTrack = 'dQw4w9WgXcQ';
const nextTrack = 'kJQP7kiw5Fk';
interface PeerReport {
  time: number;
  trackId?: string;
  position: number;
  playing: boolean;
  rate: number;
  code?: string;
  participants: number;
  queue: number;
  sync: string;
  error?: string;
}
function nodes(overlay: OverlayRegistry): UINode[] {
  return overlay.get().panels.find((panel) => panel.pluginId === pluginId)?.nodes ?? [];
}
async function waitFor(
  test: () => boolean | Promise<boolean>,
  description: string,
  timeout = 40000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      await Promise.resolve()
        .then(test)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Listen Together timed out: ${description}`);
}
function action(
  plugins: PluginHost,
  overlay: OverlayRegistry,
  label: string,
  value?: string | number | boolean,
): void {
  const node = nodes(overlay).find((node) => 'label' in node && node.label === label);
  assert(node && 'action' in node, `Room action missing: ${label}`);
  plugins.action(pluginId, node.action, value);
}
function command(desktop: DesktopWindow, value: PlayerCommand): Promise<unknown> {
  return desktop.window.webContents.executeJavaScript(
    `window.ytmusic.request(${JSON.stringify({ type: 'player', command: value })})`,
  );
}
async function prepare(desktop: DesktopWindow, plugins: PluginHost): Promise<void> {
  desktop.window.show();
  desktop.music.webContents.setAudioMuted(true);
  await plugins.enable(pluginId);
  await plugins.disable('crossfade');
  await desktop.window.webContents.executeJavaScript(
    `window.ytmusic.request({type:'snapshot'}).then(async snapshot=>{snapshot.settings.rooms.server='ws://127.0.0.1:8787';snapshot.settings.rooms.autoStartLocal=true;await window.ytmusic.request({type:'settings',settings:snapshot.settings})})`,
  );
}

// Runs in an independent app process/profile. Only bounded song/state metadata
// is written for the parent test; no cookies, session copies or media URLs.
export async function runRoomPeer(
  desktop: DesktopWindow,
  music: MusicContext,
  plugins: PluginHost,
  overlay: OverlayRegistry,
  input: string,
): Promise<void> {
  const code = input.startsWith('ytmusic-plus:') ? parseRoomInvite(input).code : input;
  assert(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code));
  await prepare(desktop, plugins);
  const path = join(app.getPath('userData'), 'room-peer-state.json');
  let stopped = false;
  const reporter = async () => {
    const state = music.getState();
    const panel = nodes(overlay);
    const participants = panel.find((node) => node.type === 'participants');
    const room = panel.find((node) => node.type === 'code');
    const queue = panel.find(
      (node) => node.type === 'text' && node.text.startsWith('Shared queue'),
    );
    const sync = panel.find(
      (node) =>
        node.type === 'text' &&
        /^(Connected|Synchronizing|Reconnecting|Disconnected) ·/.test(node.text),
    );
    const error = panel.find((node) => node.type === 'text' && node.tone === 'error');
    const rate = (await desktop.music.webContents
      .executeJavaScript('document.querySelector("video,audio")?.playbackRate ?? 1')
      .catch(() => 1)) as number;
    const report: PeerReport = {
      time: Date.now(),
      trackId: state.track?.videoId,
      position: state.track?.position ?? 0,
      playing: state.playing,
      rate,
      code: room?.type === 'code' ? room.text : undefined,
      participants: participants?.type === 'participants' ? participants.participants.length : 0,
      queue: queue?.type === 'text' ? Number(queue.text.match(/\d+/)?.[0]) : 0,
      sync: sync?.type === 'text' ? sync.text : room ? '' : 'Disconnected',
      error: error?.type === 'text' ? error.text : undefined,
    };
    if (!stopped) await writeFile(path, JSON.stringify(report));
  };
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending
      .then(reporter)
      .catch((error) => console.error('ROOM_PEER_REPORT', String(error)));
  }, 400);
  app.once('before-quit', () => {
    stopped = true;
    clearInterval(timer);
  });
  action(plugins, overlay, 'Invite or room code', input);
  action(plugins, overlay, 'Join room');
  await waitFor(
    () => nodes(overlay).some((node) => node.type === 'code' && node.text === code),
    'second app joined',
  );
  console.log('ROOM_PEER_JOINED');
  // Parent owns this process and closes it after testing.
  await new Promise<void>((resolve) => app.once('before-quit', () => resolve()));
}

export async function runRoomsSmoke(
  desktop: DesktopWindow,
  music: MusicContext,
  plugins: PluginHost,
  overlay: OverlayRegistry,
  internet = false,
): Promise<void> {
  await prepare(desktop, plugins);
  await desktop.music.webContents.loadURL(`https://music.youtube.com/watch?v=${firstTrack}`);
  await waitFor(
    () =>
      music.getState().track?.videoId === firstTrack &&
      (music.getState().track?.duration ?? 0) > 100,
    'host native song',
  );
  await command(desktop, { type: 'pause' });
  await command(desktop, { type: 'seek', value: 20 });
  await command(desktop, { type: 'openQueue' });
  await waitFor(
    () =>
      music.getState().queue.length > 1 &&
      !music.getState().playing &&
      Math.abs((music.getState().track?.position ?? 0) - 20) < 0.5,
    'host ready with queue and paused position',
  );
  action(plugins, overlay, internet ? 'Start internet room' : 'Create room');
  await waitFor(
    () => nodes(overlay).some((node) => node.type === 'code'),
    'create room from app',
    internet ? 100000 : 40000,
  );
  const codeNode = nodes(overlay).find((node) => node.type === 'code');
  assert(codeNode?.type === 'code');
  const code = codeNode.text;
  let invite: string | undefined;
  const originalClipboard = internet ? await clipboard.readText() : undefined;
  if (internet) {
    action(plugins, overlay, 'Copy invite');
    await waitFor(
      async () => (await clipboard.readText()).startsWith('ytmusic-plus://room?'),
      'copy full invite',
    );
    invite = await clipboard.readText();
    const parsed = parseRoomInvite(invite);
    assert.equal(parsed.code, code);
    assert.equal(parsed.kind, 'peerjs');
    if (parsed.kind === 'peerjs') assert(/^ytmp-/.test(parsed.peerId));
    await clipboard.writeText(originalClipboard!);
    console.log(
      'P2P_INVITE_OK: PeerJS host; copied invite contains peer ID, room code and private token',
    );
  }
  const peerPath = join(app.getPath('userData'), 'room-peer', 'room-peer-state.json');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const args = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    '--smoke-test',
    invite ? `--rooms-invite=${Buffer.from(invite).toString('base64url')}` : `--rooms-peer=${code}`,
    '--safe-renderer',
  ];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exit: number | null | undefined;
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-8000);
  });
  child.stderr.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-8000);
  });
  child.on('exit', (code) => {
    exit = code;
  });
  child.on('error', (error) => {
    output += String(error);
    exit = 1;
  });
  const peer = async (requireRoom = true): Promise<PeerReport> => {
    if (exit !== undefined) throw new Error(`Peer exited (${exit}): ${output}`);
    const report = JSON.parse(await readFile(peerPath, 'utf8')) as PeerReport;
    assert(Date.now() - report.time < 5000 && (!requireRoom || report.code === code));
    return report;
  };
  try {
    await waitFor(
      async () => {
        const other = await peer();
        return (
          other.participants === 2 &&
          other.trackId === firstTrack &&
          !other.playing &&
          Math.abs(other.position - 20) < 0.6
        );
      },
      'independent listener opens exact song and paused position',
      60000,
    );
    assert((await peer()).queue > 1, 'creating a room must include the existing host queue');
    console.log(
      'ROOM_JOIN_SYNC_OK: two independent app profiles; same native song and paused position; shared queue',
    );
    action(plugins, overlay, 'Play / pause');
    await waitFor(
      async () => (await peer()).playing && music.getState().playing,
      'host play reaches listener',
    );
    await new Promise((resolve) => setTimeout(resolve, 2400));
    action(plugins, overlay, 'Play / pause');
    await waitFor(async () => {
      const other = await peer();
      return (
        !other.playing &&
        !music.getState().playing &&
        Math.abs(other.position - (music.getState().track?.position ?? 0)) < 0.75
      );
    }, 'host pause reaches listener');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await command(desktop, { type: 'seek', value: 60 });
    await waitFor(async () => {
      const other = await peer();
      return !other.playing && Math.abs(other.position - 60) < 0.6;
    }, 'host seek reaches listener');
    console.log('ROOM_PLAY_PAUSE_SEEK_OK: host controls synchronized real native players');
    action(plugins, overlay, 'Add song', `https://music.youtube.com/watch?v=${nextTrack}`);
    action(plugins, overlay, 'Add to shared queue');
    await waitFor(
      () =>
        nodes(overlay).some(
          (node) => node.type === 'button' && node.action === `action:queue-${nextTrack}`,
        ),
      'added shared queue song',
    );
    plugins.action(pluginId, `action:queue-${nextTrack}`);
    await waitFor(
      async () => {
        const other = await peer();
        return (
          other.trackId === nextTrack &&
          other.playing &&
          music.getState().track?.videoId === nextTrack &&
          music.getState().playing
        );
      },
      'shared queue track change reaches both players',
      60000,
    );
    await waitFor(
      async () => Math.abs((await peer()).position - (music.getState().track?.position ?? 0)) < 1,
      'position converges after track load',
    );
    console.log('ROOM_TRACK_CHANGE_OK: both apps open and play the exact shared queue video');
    action(plugins, overlay, 'Leave room');
    await waitFor(
      () => nodes(overlay).some((node) => node.type === 'button' && node.label === 'Create room'),
      'host leaves room',
    );
    if (internet) {
      await waitFor(
        async () => /Reconnecting|Disconnected/.test((await peer(false)).sync),
        'leaving host closes its P2P connections',
      );
      console.log('P2P_CLEANUP_OK: leaving host closes WebRTC and signaling connections');
    } else
      await waitFor(
        async () => (await peer()).participants === 1,
        'remaining listener receives host transfer',
      );
    await plugins.disable(pluginId);
    assert.equal(
      await desktop.music.webContents.executeJavaScript(
        'document.querySelector("video,audio").playbackRate',
      ),
      1,
      'disable restores normal playback rate',
    );
    console.log(
      internet
        ? 'P2P_ROOMS_OK: PeerJS WebRTC; pasted invite; two native players synchronize song, play/pause, seek and queue; host cleanup'
        : 'ROOMS_OK: create/join; native playback, pause, seek, shared queue and exact song; leave/host transfer; disable cleanup',
    );
  } catch (error) {
    console.error('ROOMS_DIAGNOSTIC', {
      host: music.getState(),
      panel: nodes(overlay),
      peer: await peer().catch(() => undefined),
      output,
    });
    throw error;
  } finally {
    if (originalClipboard !== undefined) await clipboard.writeText(originalClipboard);
    child.kill();
    await plugins.disable(pluginId);
    await command(desktop, { type: 'pause' }).catch(() => {});
  }
}
