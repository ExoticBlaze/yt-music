import { BrowserWindow } from 'electron';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { CrossfadeService } from '../../src/main/music/crossfade-service';
import type { MusicContext } from '../../src/main/music/context';
import type { PluginHost } from '../../src/main/plugins/plugin-host';
import type { OverlayRegistry } from '../../src/main/plugins/overlay-registry';
import { AudioGainClient } from '../../src/main/music/audio-gain-client';

async function waitFor(
  test: () => boolean | Promise<boolean>,
  description: string,
  timeout = 25000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      await Promise.resolve()
        .then(test)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Crossfade timed out: ${description}`);
}

function fixture(): string {
  const header = Buffer.alloc(44);
  const samples = Buffer.alloc(8000 * 30, 128);
  header.write('RIFF');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  const data = Buffer.concat([header, samples]).toString('base64');
  return `<!doctype html><html><body><ytmusic-app></ytmusic-app>
    <ytmusic-player-bar><span class="title">Outgoing</span><div class="byline"><a>Test artist</a></div>
    <button class="next-button" onclick="window.currentId='zyxwvutsrqp';document.querySelector('.title').textContent='Incoming';const media=document.querySelector('audio');media.currentTime=0;media.play()">Next</button>
    <div class="volume"><button aria-label="Mute">Mute</button><input id="volume-slider" type="range" min="0" max="1" step=".01" value=".37" oninput="document.querySelector('audio').volume=Number(this.value)"></div></ytmusic-player-bar>
    <ytmusic-player-queue><ytmusic-player-queue-item><a href="/watch?v=abcdefghijk">Outgoing</a></ytmusic-player-queue-item><ytmusic-player-queue-item><a href="/watch?v=zyxwvutsrqp">Incoming</a></ytmusic-player-queue-item></ytmusic-player-queue>
    <audio preload="auto" src="data:audio/wav;base64,${data}"></audio><div id="movie_player"></div>
    <script>window.currentId='abcdefghijk';window.ytcfg={get:()=>false};
    const api=document.querySelector('#movie_player'),media=document.querySelector('audio');
    api.getVideoData=()=>({video_id:window.currentId,title:document.querySelector('.title').textContent,author:'Test artist'});
    api.getDuration=()=>media.duration;api.getCurrentTime=()=>media.currentTime;api.getPlayerState=()=>media.paused?2:1;
    document.querySelectorAll('ytmusic-player-queue-item').forEach((node,index)=>node.data={videoId:index?'zyxwvutsrqp':'abcdefghijk',title:{runs:[{text:index?'Incoming':'Outgoing'}]}});
    </script></body></html>`;
}

export async function runCrossfadeSmoke(
  desktop: DesktopWindow,
  service: CrossfadeService,
  music: MusicContext,
  plugins: PluginHost,
  overlay: OverlayRegistry,
): Promise<void> {
  await plugins.enable('crossfade');
  if (
    !overlay
      .get()
      .panels.some(
        (panel) =>
          panel.pluginId === 'crossfade' &&
          panel.nodes.some((node) => node.type === 'range' && node.max === 12),
      )
  )
    throw new Error('Crossfade settings panel is missing');
  overlay.open('crossfade', 'crossfade');
  await waitFor(
    () =>
      desktop.window.webContents.executeJavaScript(
        'document.querySelector(".plugin-panel h2")?.textContent === "Crossfade"',
      ),
    'settings visible',
  );
  await desktop.window.webContents.executeJavaScript(
    'const slider=document.querySelector(".plugin-panel input[type=range]");slider.value="7";slider.dispatchEvent(new Event("change",{bubbles:true}));true',
  );
  await waitFor(() => service.status('crossfade').seconds === 7, 'duration setting');
  await plugins.reload('crossfade');
  if (service.status('crossfade').seconds !== 7)
    throw new Error('Crossfade duration did not persist');
  const durationAction = overlay
    .get()
    .panels.find((panel) => panel.pluginId === 'crossfade')
    ?.nodes.find((node) => node.type === 'range')?.action;
  if (!durationAction) throw new Error('Crossfade duration action is missing');
  plugins.action('crossfade', durationAction, 5);
  await waitFor(() => service.status('crossfade').seconds === 5, 'default duration restored');
  overlay.view('music');
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"play"}})',
  );
  await waitFor(() => music.getState().playing, 'resume actual song after the playback checks');
  // Check eligibility against actual YouTube audio before replacing the page
  // with controlled media. Samples and stream URLs never leave the renderer.
  const primary = new AudioGainClient(desktop.music.webContents);
  const real = await primary.command();
  if (!real.supported) throw new Error(`Real YouTube Music cannot fade: ${real.reason}`);
  console.log('CROSSFADE_NATIVE_OK: real YouTube Music audio supports independent gain');
  const outgoingId = music.getState().track?.videoId;
  if (!outgoingId) throw new Error('No actual song for crossfade verification');
  service.configure('crossfade', { enabled: true, seconds: 5 });
  await desktop.music.webContents.executeJavaScript(
    'document.querySelector("video,audio").currentTime=document.querySelector("video,audio").duration-25',
  );
  await waitFor(
    () => {
      const status = service.status('crossfade');
      if (status.message) throw new Error(status.message);
      return status.phase === 'ready';
    },
    'real outgoing song buffered',
    35000,
  ).catch(async (error) => {
    const companion = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().startsWith('https://music.youtube.com/watch?'),
    );
    console.log('CROSSFADE_PREPARE_DIAGNOSTIC', {
      status: service.status('crossfade'),
      music: {
        track: music.getState().track,
        playing: music.getState().playing,
        queue: music.getState().queue.length,
      },
      companion: await companion?.webContents.executeJavaScript(
        '(()=>{const media=document.querySelector("video,audio");return {title:document.title,ready:media?.readyState,paused:media?.paused,duration:media?.duration,position:media?.currentTime,source:!!media?.currentSrc,visibility:document.visibilityState}})()',
      ),
    });
    throw error;
  });
  const actualCompanion = BrowserWindow.getAllWindows().find(
    (window) => window.webContents.getURL() === `https://music.youtube.com/watch?v=${outgoingId}`,
  );
  if (!actualCompanion) throw new Error('Native outgoing player was not created');
  const actualAudio = new AudioGainClient(actualCompanion.webContents);
  let adFallback = false;
  try {
    const a = (await desktop.music.webContents.executeJavaScript(
      'document.querySelector("video,audio").volume',
    )) as number;
    const b = (await actualCompanion.webContents.executeJavaScript(
      'document.querySelector("video,audio").volume',
    )) as number;
    if (Math.abs(a - b) > 0.02) throw new Error(`Companion volume mismatch: ${a} / ${b}`);
    await waitFor(
      async () => {
        const incoming = await primary.command();
        if (
          music.getState().ad &&
          service.status('crossfade').phase === 'waiting' &&
          actualCompanion.isDestroyed() &&
          incoming.gain === 1
        ) {
          adFallback = true;
          return true;
        }
        if (actualCompanion.isDestroyed()) return false;
        const outgoing = await actualAudio.command();
        return (
          music.getState().track?.videoId !== outgoingId &&
          incoming.playing &&
          outgoing.playing &&
          incoming.gain > 0.05 &&
          incoming.gain < 0.98 &&
          outgoing.gain > 0.05 &&
          outgoing.gain < 0.98
        );
      },
      'real songs overlap with independent audio fades',
      40000,
    ).catch(async (error) => {
      console.log('CROSSFADE_OVERLAP_DIAGNOSTIC', {
        status: service.status('crossfade'),
        track: music.getState().track,
        playing: music.getState().playing,
        ad: music.getState().ad,
        primary: await primary.command(),
        secondary: actualCompanion.isDestroyed() ? 'closed' : await actualAudio.command(),
      });
      throw error;
    });
    console.log(
      adFallback
        ? 'CROSSFADE_AD_FALLBACK_OK: native outgoing song buffered; incoming ad restored normal audio and closed the companion'
        : 'CROSSFADE_LIVE_OK: two actual YouTube Music songs overlap through normal native playback',
    );
  } finally {
    actualAudio.dispose();
    service.remove('crossfade');
  }
  await plugins.disable('crossfade');
  const protocol = desktop.music.webContents.session.protocol;
  const html = fixture();
  await protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (
      url.origin === 'https://music.youtube.com' &&
      (url.pathname === '/__ytm-crossfade-smoke' || url.pathname === '/watch')
    )
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 404 });
  });
  let secondary: AudioGainClient | undefined;
  try {
    desktop.music.webContents.setAudioMuted(true);
    await desktop.music.webContents.loadURL('https://music.youtube.com/__ytm-crossfade-smoke');
    await waitFor(
      () =>
        desktop.music.webContents.executeJavaScript(
          'document.querySelector("audio")?.readyState >= 2',
        ),
      'controlled media',
    );
    await desktop.window.webContents.executeJavaScript(
      'window.ytmusic.request({type:"player",command:{type:"setVolume",value:.37}})',
    );
    await desktop.music.webContents.executeJavaScript(
      'document.querySelector("audio").play()',
      true,
    );
    await waitFor(
      () => music.getState().playing && music.getState().track?.videoId === 'abcdefghijk',
      'primary state',
    );
    service.configure('crossfade', { enabled: true, seconds: 3 });
    await waitFor(() => service.status('crossfade').phase === 'ready', 'outgoing song buffered');
    const companion = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'https://music.youtube.com/watch?v=abcdefghijk',
    );
    if (!companion || companion.isVisible()) throw new Error('Crossfade companion must be hidden');
    secondary = new AudioGainClient(companion.webContents);
    // Simulate the passage of time, rather than sending the app's user Seek
    // command, which correctly cancels a prepared transition.
    await desktop.music.webContents.executeJavaScript(
      'document.querySelector("audio").currentTime=26.9',
    );
    await waitFor(
      () =>
        music.getState().track?.videoId === 'zyxwvutsrqp' &&
        service.status('crossfade').phase === 'crossfading',
      'native Next and overlap',
    );
    await waitFor(
      async () => {
        const a = await primary.command();
        const b = await secondary!.command();
        return (
          a.playing && b.playing && a.gain > 0.1 && a.gain < 0.95 && b.gain > 0.1 && b.gain < 0.95
        );
      },
      'two playing songs with complementary audio gains',
      4000,
    );
    const volume = (await desktop.music.webContents.executeJavaScript(
      '({volume:document.querySelector("audio").volume,percent:document.querySelector("#ytmusic-plus-volume-percent").textContent})',
    )) as { volume: number; percent: string };
    if (Math.abs(volume.volume - 0.37) > 0.001 || volume.percent !== '37%')
      throw new Error('Crossfade changed the saved volume');
    // Disabling while both decks are active must restore the native output.
    service.remove('crossfade');
    await waitFor(
      async () => (await primary.command()).gain === 1 && companion.isDestroyed(),
      'disable cleanup and restored native gain',
    );
    secondary.dispose();
    secondary = undefined;
    await plugins.enable('crossfade');
    await plugins.disable('crossfade');
    if (overlay.get().contributions.some((value) => value.pluginId === 'crossfade'))
      throw new Error('Crossfade UI survived disable');
    await plugins.enable('crossfade');
    if (service.status('crossfade').seconds !== 5)
      throw new Error('Crossfade default settings were not restored');
    console.log(
      'CROSSFADE_OK: hidden native player; real preload; concurrent playback; equal-power gains; unchanged 37% volume; disable cleanup; reload',
    );
  } finally {
    service.remove('crossfade');
    secondary?.dispose();
    primary.dispose();
    await protocol.unhandle('https');
  }
}
