import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { PluginHost } from '../../src/main/plugins/plugin-host';
import type { AdBlockService } from '../../src/main/blocking/ad-block-service';
import type { OverlayRegistry } from '../../src/main/plugins/overlay-registry';
import { captureScreenshot } from './capture';
import { NATIVE_PLAYER_HEIGHT } from '../../src/shared/constants/layout';
import { IPC } from '../../src/shared/constants/ipc';

function silentMediaURL(): string {
  const samples = Buffer.alloc(8000 * 30, 128);
  const header = Buffer.alloc(44);
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
  const audio = Buffer.concat([header, samples]).toString('base64');
  return `data:audio/wav;base64,${audio}`;
}

function playerFixture(): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Playback regression fixture</title></head>
    <body style="background:#090909;color:white;font-family:system-ui;padding:40px">
    <h1>Playback regression fixture</h1><p>Silent media verifies the app's real isolated preload and controls.</p>
    <ytmusic-app></ytmusic-app>
    <ytmusic-player-bar style="display:block;min-height:64px"><span class="title">Playback test</span><div class="byline"><a href="channel/UCfixture" onclick="event.preventDefault();document.body.dataset.artist='open'">YTMusic+</a><a>Regression checks</a></div>
    <yt-icon-button id="play-pause-button"><button onclick="const media=document.querySelector('video,audio');media.paused?media.play():media.pause()">Play / Pause</button></yt-icon-button>
    <input id="progress-bar" aria-label="Seek" type="range" min="0" max="30" onchange="document.querySelector('video,audio').currentTime=Number(this.value)">
    <div class="volume"><button aria-label="Mute" onclick="const media=document.querySelector('video,audio');media.muted=!media.muted">Mute</button><input id="volume-slider" aria-label="Volume" type="range" min="0" max="1" step=".01" oninput="document.querySelector('video,audio').volume=Number(this.value);document.querySelector('video,audio').muted=false"></div>
    <button class="shuffle" aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')==='false')">Shuffle</button>
    <button class="repeat" title="Repeat off" onclick="this.title=this.title==='Repeat off'?'Repeat all':this.title==='Repeat all'?'Repeat one':'Repeat off'">Repeat</button>
    <ytmusic-like-button-renderer><button aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')==='false')">Like</button></ytmusic-like-button-renderer>
    <yt-icon-button class="next-button"><button onclick="document.querySelector('.title').textContent='Next track';document.querySelector('video,audio').volume=1">Next</button></yt-icon-button>
    <yt-icon-button class="previous-button"><button onclick="document.querySelector('.title').textContent='Playback test'">Previous</button></yt-icon-button>
    <yt-icon-button class="toggle-player-page-button"><button onclick="const app=document.querySelector('ytmusic-app');app.playerPageOpen=!app.playerPageOpen;document.querySelector('ytmusic-player-page').toggleAttribute('player-page-open',app.playerPageOpen);document.body.dataset.playerPage=String(app.playerPageOpen)">Player page</button></yt-icon-button></ytmusic-player-bar>
    <ytmusic-player-page><div id="side-panel"><tp-yt-paper-tabs><tp-yt-paper-tab>Up next</tp-yt-paper-tab><tp-yt-paper-tab disabled aria-disabled="true" style="pointer-events:none">Lyrics</tp-yt-paper-tab><tp-yt-paper-tab>Related</tp-yt-paper-tab></tp-yt-paper-tabs><ytmusic-tab-renderer id="tab-renderer">Native queue</ytmusic-tab-renderer></div></ytmusic-player-page>
    <ytmusic-player-queue><ytmusic-player-queue-item><ytmusic-play-button-renderer role="button" onclick="document.querySelector('.title').textContent='Playback test';window.currentId='abcdefghijk'">Play</ytmusic-play-button-renderer><span class="song-title">Playback test</span></ytmusic-player-queue-item><ytmusic-player-queue-item><ytmusic-play-button-renderer role="button" onclick="document.querySelector('.title').textContent='Queued track';window.currentId='zyxwvutsrqp';document.querySelector('video,audio').volume=1">Play</ytmusic-play-button-renderer><span class="song-title">Queued track</span></ytmusic-player-queue-item></ytmusic-player-queue>
    <video muted preload="auto" src="${silentMediaURL()}"></video>
    <div id="movie_player"></div><script>
    window.ytcfg={get:()=>false};
    const api=document.querySelector('#movie_player');
    api.getVideoData=()=>({title:document.querySelector('.title')?.textContent||'Fallback track',author:'YTMusic+',video_id:window.currentId||'abcdefghijk'});
    api.getDuration=()=>30;api.getCurrentTime=()=>document.querySelector('video,audio').currentTime;
    api.getPlayerState=()=>document.querySelector('video,audio').paused?2:1;
    document.querySelector('ytmusic-app').playerPageOpen=false;
    document.addEventListener('keydown',event=>{if(event.key==='m')document.querySelector('video,audio').muted=!document.querySelector('video,audio').muted});
    document.addEventListener('yt-navigate',event=>{if(event.detail?.endpoint?.browseEndpoint?.browseId==='UCfixture')document.body.dataset.artist='open'});
    [...document.querySelectorAll('ytmusic-player-queue-item')].forEach((item,index)=>item.data={title:{runs:[{text:index?'Queued track':'Playback test'}]},shortBylineText:{runs:[{text:'YTMusic+'}]},videoId:index?'zyxwvutsrqp':'abcdefghijk',lengthText:{runs:[{text:'0:30'}]},longBylineText:{runs:[{text:'YTMusic+',navigationEndpoint:{browseEndpoint:{browseId:'UCfixture'}}}]}});
    </script></body></html>`;
}

// This is the newer desktop miniplayer, with no legacy player-bar or volume IDs.
// Its hidden vertical slider uses 0..100 rather than the classic fixture's 0..1.
function modernPlayerFixture(): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Modern player regression</title></head>
    <body style="background:#090909;color:white;font-family:system-ui">
    <h1>Modern native player regression</h1><ytmusic-app></ytmusic-app>
    <ytmusic-miniplayer style="display:flex;align-items:center;position:fixed;bottom:0;left:0;right:0;background:#170f21" onclick="if(!event.target.closest('button,input,a')){document.querySelector('ytmusic-app').playerPageOpen=true;document.querySelector('ytmusic-player-page').setAttribute('player-page-open','')}">
      <div class="ytMusicMiniPlayerLeftSection" style="display:flex;align-items:center;flex:1">
        <ytmusic-track-info><div class="ytmusicTrackInfoTitle">Modern track</div>
        <div class="ytmusicTrackInfoByline"><a href="channel/UCfixture" onclick="event.preventDefault()">Modern artist</a></div></ytmusic-track-info>
      </div>
      <div class="ytMusicMiniPlayerMiddleSection"><button aria-label="Play" onclick="document.querySelector('video').play()">Play</button><button aria-label="Next" onclick="document.querySelector('.ytmusicTrackInfoTitle').textContent='Modern next';document.querySelector('video').volume=1">Next</button></div>
      <div class="ytMusicMiniPlayerRightSection" style="display:flex;align-items:center;justify-content:flex-end;flex:1">
        <div class="ytMusicMiniPlayerVolumeWrapper" style="display:flex"><div><button aria-label="Mute" onclick="const media=document.querySelector('video');media.muted=!media.muted">Mute</button></div>
          <div class="ytMusicMiniPlayerVolumePopup" style="display:none"><slider-shape><input id="slider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume" oninput="document.querySelector('video').volume=Number(this.value)/100;document.querySelector('video').muted=false"></slider-shape></div>
        </div>
      </div>
    </ytmusic-miniplayer><ytmusic-player-page></ytmusic-player-page>
    <video preload="auto" src="${silentMediaURL()}"></video>
    <div id="movie_player"></div><script>
      window.ytcfg={get:()=>false};const api=document.querySelector('#movie_player');
      api.getVideoData=()=>({title:document.querySelector('.ytmusicTrackInfoTitle').textContent,author:'Modern artist',video_id:'abcdefghijk'});
      api.getDuration=()=>30;api.getCurrentTime=()=>document.querySelector('video').currentTime;
      api.getPlayerState=()=>document.querySelector('video').paused?2:1;
      document.querySelector('ytmusic-app').playerPageOpen=false;
    </script></body></html>`;
}

async function waitFor(test: () => Promise<boolean>, description: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await test().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Feature smoke timed out: ${description}`);
}

export async function runFeatureSmoke(
  desktop: DesktopWindow,
  plugins: PluginHost,
  blocker: AdBlockService,
  overlay: OverlayRegistry,
  output: string,
): Promise<void> {
  const fixtureURL = 'https://music.youtube.com/__ytm-smoke-player?v=abcdefghijk';
  const session = desktop.music.webContents.session;
  desktop.music.webContents.setAudioMuted(true);
  let modern = false;
  let modernWindow: BrowserWindow | undefined;
  let modernTrack = '';
  let modernVolume = -1;
  const modernState = (event: Electron.IpcMainEvent, value: { track?: { title?: string } }) => {
    if (event.sender.id === modernWindow?.webContents.id) modernTrack = value.track?.title ?? '';
  };
  const modernPreference = (event: Electron.IpcMainEvent, value: { volume: number }) => {
    if (event.sender.id === modernWindow?.webContents.id) modernVolume = value.volume;
  };
  ipcMain.on(IPC.musicState, modernState);
  ipcMain.on(IPC.volumePreference, modernPreference);
  await session.protocol.handle('https', (request) =>
    request.url === fixtureURL
      ? new Response(modern ? modernPlayerFixture() : playerFixture(), {
          headers: {
            'Content-Type': 'text/html',
            'Content-Security-Policy':
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src data:; connect-src https://*.doubleclick.net",
          },
        })
      : session.fetch(request, { bypassCustomProtocolHandlers: true }),
  );
  try {
    await desktop.music.webContents.loadURL(fixtureURL);
    const music = (expression: string) =>
      (modernWindow?.webContents ?? desktop.music.webContents).executeJavaScript(
        expression,
      ) as Promise<boolean>;
    const shell = (expression: string) =>
      desktop.window.webContents.executeJavaScript(expression) as Promise<boolean>;
    const trackIs = (title: string) =>
      modernWindow
        ? Promise.resolve(modernTrack === title)
        : shell(
            `window.ytmusic.request({type:'snapshot'}).then(value=>value.music.track?.title===${JSON.stringify(title)})`,
          );
    await waitFor(() => trackIs('Playback test'), 'track metadata');
    if (!(await shell('!document.querySelector("#playerbar")')))
      throw new Error('Custom player is still present');
    await music('document.querySelector("#play-pause-button button").click(); true');
    await waitFor(() => music('!document.querySelector("video").paused'), 'play button');
    await music('document.querySelector("#play-pause-button button").click(); true');
    await waitFor(() => music('document.querySelector("video").paused'), 'pause button');
    await music(
      'const seek=document.querySelector("#progress-bar"); seek.value="12"; seek.dispatchEvent(new Event("change",{bubbles:true})); true',
    );
    await waitFor(
      () => music('Math.abs(document.querySelector("video").currentTime - 12) < 0.25'),
      'seek slider',
    );
    await music(
      'const volume=document.querySelector("#volume-slider"); volume.value="0.4"; volume.dispatchEvent(new Event("input",{bubbles:true})); true',
    );
    await waitFor(
      () => music('Math.abs(document.querySelector("video").volume - 0.4) < 0.01'),
      'volume slider',
    );
    await music('document.querySelector(".shuffle").click(); true');
    await waitFor(
      () => music('document.querySelector(".shuffle").getAttribute("aria-pressed") === "true"'),
      'shuffle',
    );
    await music('document.querySelector(".repeat").click(); true');
    await waitFor(
      () => music('document.querySelector(".repeat").title === "Repeat all"'),
      'repeat',
    );
    await music('document.querySelector("ytmusic-like-button-renderer button").click(); true');
    await waitFor(
      () =>
        music(
          'document.querySelector("ytmusic-like-button-renderer button").getAttribute("aria-pressed") === "true"',
        ),
      'like',
    );
    await shell(
      'window.ytmusic.request({type:"player",command:{type:"openQueue"}}).then(()=>true)',
    );
    await waitFor(
      () =>
        music(
          'document.body.dataset.playerPage === "true" && document.querySelectorAll("ytmusic-player-queue-item").length === 2',
        ),
      'native Up next via app queue command',
    );
    await music(
      'document.querySelectorAll("ytmusic-player-queue-item ytmusic-play-button-renderer")[1].click();true',
    );
    await waitFor(() => trackIs('Queued track'), 'select a queued track');
    await waitFor(
      () => music('Math.abs(document.querySelector("video").volume - .4) < .001'),
      'saved volume after queue transition',
    );
    await music('document.querySelector(".toggle-player-page-button button").click();true');
    await waitFor(
      () => music('document.body.dataset.playerPage === "false"'),
      'collapse native player page',
    );
    await music('document.querySelector(".toggle-player-page-button button").click();true');
    await waitFor(
      () => music('document.body.dataset.playerPage === "true"'),
      'full native player via nested button',
    );
    if (desktop.music.getBounds().width !== desktop.window.getContentSize()[0])
      throw new Error('Native queue reduced the music view width');
    await music('document.querySelector(".byline a").click();true');
    await waitFor(() => music('document.body.dataset.artist === "open"'), 'click artist');
    desktop.window.hide();
    await music(
      'document.querySelector(".title").dispatchEvent(new WheelEvent("wheel",{deltaY:-120,cancelable:true,bubbles:true}));true',
    );
    await waitFor(
      () =>
        music(
          'Math.abs(document.querySelector("video").volume - .42) < .001 && document.querySelector("#ytmusic-plus-volume-percent").textContent === "42%"',
        ),
      'wheel anywhere on bar increases volume and percentage',
    );
    if (
      !(await music(
        'document.querySelector("h1").dispatchEvent(new WheelEvent("wheel",{deltaY:-120,cancelable:true,bubbles:true}))',
      ))
    )
      throw new Error('Volume wheel intercepted scrolling outside the player bar');
    if (!(await music('Math.abs(document.querySelector("video").volume - .42) < .001')))
      throw new Error('Scrolling outside the player bar changed volume');
    desktop.window.show();
    await music(
      'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"m",bubbles:true}));true',
    );
    await waitFor(() => music('document.querySelector("video").muted'), 'native mute shortcut');
    await music(
      'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"m",bubbles:true}));true',
    );
    await waitFor(() => music('!document.querySelector("video").muted'), 'native unmute shortcut');
    await music('document.querySelector("[aria-label=Mute]").click();true');
    await waitFor(
      () =>
        music(
          'document.querySelector("video").muted && document.querySelector("#ytmusic-plus-volume-percent").textContent === "0%"',
        ),
      'mute and percentage',
    );
    await music('document.querySelector("[aria-label=Mute]").click();true');
    await waitFor(
      () =>
        music(
          '!document.querySelector("video").muted && Math.abs(document.querySelector("video").volume - .42) < .001',
        ),
      'unmute preserves volume',
    );
    await music('document.querySelector(".next-button button").click(); true');
    await waitFor(() => trackIs('Next track'), 'next track');
    await waitFor(
      () => music('Math.abs(document.querySelector("video").volume - .42) < .001'),
      'saved volume after next',
    );
    await music('document.querySelector(".previous-button button").click(); true');
    await waitFor(() => trackIs('Playback test'), 'previous track');
    await waitFor(
      () =>
        shell(
          'document.querySelector(".account-action").textContent === "Sign in" && !document.querySelector(".account-action").hidden',
        ),
      'signed-out account control',
    );
    await music('window.ytcfg.get=()=>true; true');
    await waitFor(
      () => shell('document.querySelector(".account-action").textContent === "Sign out"'),
      'signed-in account control',
    );
    await music('window.ytcfg.get=()=>false; true');
    await waitFor(
      () => shell('document.querySelector(".account-action").textContent === "Sign in"'),
      'sign-out state change',
    );
    overlay.open('lyrics', 'lyrics');
    await waitFor(
      () =>
        music(
          'document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics-active") && document.querySelector("#ytmusic-plus-native-lyrics").getBoundingClientRect().height > 0',
        ),
      'lyrics in native tab',
    );
    if (desktop.music.getBounds().width !== desktop.window.getContentSize()[0])
      throw new Error('Native lyrics opened a separate app sidebar');
    await music('document.querySelector("tp-yt-paper-tab").click(); true');
    await waitFor(
      () => music('!document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics-active")'),
      'native queue restored',
    );
    await music('document.querySelectorAll("tp-yt-paper-tab")[1].click(); true');
    await waitFor(
      () => music('document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics-active")'),
      'native Lyrics tab click',
    );
    await plugins.disable('lyrics');
    await waitFor(
      () =>
        music(
          '!document.querySelector("#ytmusic-plus-native-lyrics") && !document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics")',
        ),
      'native lyrics cleanup',
    );
    await plugins.enable('lyrics');
    desktop.window.restore();
    desktop.window.show();
    let layout = '';
    await waitFor(async () => {
      const bounds = desktop.music.getBounds();
      const [, height = 960] = desktop.window.getContentSize();
      layout = JSON.stringify({ bounds, height, minimized: desktop.window.isMinimized() });
      return bounds.y + bounds.height === height - 32;
    }, 'music view respects extension dock bounds after layout settles').catch((error) => {
      throw new Error(`${String(error)}: ${layout}`);
    });
    if (
      !(await music(
        `getComputedStyle(document.querySelector("ytmusic-player-bar")).visibility === "visible" && document.querySelector("ytmusic-player-bar").getBoundingClientRect().height === ${NATIVE_PLAYER_HEIGHT}`,
      ))
    )
      throw new Error('Native website controls are hidden or have an incorrect compact height');
    const before = blocker.status('ad-blocker');
    if (!before.enabled || before.filterCount < 1000)
      throw new Error('Bundled EasyList was not loaded');
    await music('fetch("https://googleads.g.doubleclick.net/pagead/id").catch(() => false)');
    if (blocker.status('ad-blocker').blockedRequests <= before.blockedRequests)
      throw new Error('Ad request was not blocked by the music session');
    await plugins.disable('ad-blocker');
    if (blocker.status('ad-blocker').enabled)
      throw new Error('Disabling the plugin did not remove native blocking');
    await plugins.enable('ad-blocker');
    await captureScreenshot(desktop.window, join(output, 'native-player.png'));
    console.log(
      'PLAYER_OK: native play/pause/seek/volume/shuffle/repeat/like/queue/next/previous; native bar visible; no custom player; extension dock layout',
    );
    console.log('BLOCKING_OK: bundled EasyList loaded; ad request blocked; disable cleanup');
    await music(
      'window.smokeBar=document.querySelector("ytmusic-player-bar");window.smokeBar.remove();const old=document.querySelector("video"); const replacement=document.createElement("audio"); replacement.src=old.src; replacement.muted=true; old.replaceWith(replacement); true',
    );
    await waitFor(() => trackIs('Fallback track'), 'metadata without the native player bar');
    await waitFor(
      () =>
        music(
          'Math.abs(document.querySelector("audio").volume - .42) < .001 && !document.querySelector("audio").muted',
        ),
      'saved volume on a replacement media element',
    );
    await shell('window.ytmusic.request({type:"player",command:{type:"play"}}).then(()=>true)');
    await waitFor(() => music('!document.querySelector("audio").paused'), 'audio element playback');
    console.log(
      'DETECTION_OK: page-world player fallback without the bar; audio playback; account transitions; native Lyrics tab and disable cleanup',
    );
    await music('document.body.append(window.smokeBar);delete window.smokeBar;true');
    await waitFor(
      () => music('document.querySelector("#ytmusic-plus-volume-percent")?.textContent === "42%"'),
      'percentage remounts after native bar replacement',
    );
    const create = overlay
      .get()
      .panels.find((panel) => panel.pluginId === 'listen-together')
      ?.nodes.find((node) => node.type === 'button' && node.label === 'Create room');
    if (create?.type !== 'button') throw new Error('Room create action is missing');
    plugins.action('listen-together', create.action);
    await waitFor(
      async () =>
        overlay
          .get()
          .panels.some(
            (panel) =>
              panel.pluginId === 'listen-together' &&
              panel.nodes.some(
                (node) => node.type === 'code' && /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(node.text),
              ),
          ),
      'room creation through public plugin API',
    );
    const leave = overlay
      .get()
      .panels.find((panel) => panel.pluginId === 'listen-together')
      ?.nodes.find((node) => node.type === 'button' && node.label === 'Leave room');
    if (leave?.type !== 'button') throw new Error('Room leave action is missing');
    plugins.action('listen-together', leave.action);
    await waitFor(
      async () =>
        overlay
          .get()
          .panels.some(
            (panel) =>
              panel.pluginId === 'listen-together' &&
              panel.nodes.some((node) => node.type === 'button' && node.label === 'Create room'),
          ),
      'room leave',
    );
    console.log('ROOM_OK: plugin creates and leaves a room with automatic local relay startup');
    const css = await desktop.music.webContents.executeJavaScript(
      `document.querySelector('#ytmusic-plus-appearance').textContent`,
    );
    modern = true;
    modernWindow = new BrowserWindow({
      width: 1440,
      height: 876,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        backgroundThrottling: false,
        session,
        preload: join(app.getAppPath(), 'dist', 'preload', 'music.cjs'),
      },
    });
    modernWindow.webContents.setAudioMuted(true);
    await modernWindow.webContents.loadURL(fixtureURL);
    modernWindow.webContents.send(IPC.musicStyle, css);
    modernWindow.webContents.send(IPC.musicVolume, { volume: 0.42, muted: false });
    await waitFor(() => trackIs('Modern track'), 'modern player metadata');
    await waitFor(
      () =>
        music(`
      !document.querySelector('ytmusic-player-bar') &&
      document.querySelector('ytmusic-miniplayer').getBoundingClientRect().height === ${NATIVE_PLAYER_HEIGHT} &&
      document.querySelector('#ytmusic-plus-volume-percent')?.textContent === '42%' &&
      document.querySelector('#slider').value === '42' &&
      Math.abs(document.querySelector('video').volume - .42) < .001
    `),
      'modern player height, saved native slider and visible percentage',
    );
    const point = await modernWindow.webContents.executeJavaScript(`(()=>{
      const bar=document.querySelector('ytmusic-miniplayer'),r=bar.getBoundingClientRect();
      const x=Math.round(r.width/2),y=Math.round(r.y+r.height/2);
      return {x,y,inside:!!document.elementFromPoint(x,y)?.closest('ytmusic-miniplayer')};
    })()`);
    if (!point.inside) throw new Error('Modern player cannot receive real wheel input');
    modernWindow.webContents.focus();
    modernWindow.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    modernWindow.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: 120,
      canScroll: true,
    });
    await waitFor(
      () =>
        music(
          `document.querySelector('#slider').value === '44' && document.querySelector('#ytmusic-plus-volume-percent')?.textContent === '44%' && Math.abs(document.querySelector('video').volume - .44) < .001`,
        ),
      'trusted wheel on modern player',
    ).catch(async (error) => {
      console.log(
        'MODERN_WHEEL_FAILURE',
        await music(
          `(()=>{const video=document.querySelector('video');return {slider:document.querySelector('#slider').value,volume:video.volume,muted:video.muted,percent:document.querySelector('#ytmusic-plus-volume-percent').textContent,focused:document.hasFocus()}})()`,
        ),
      );
      throw error;
    });
    await music(`document.querySelector('[aria-label="Next"]').click();true`);
    await waitFor(() => trackIs('Modern next'), 'modern next control');
    await waitFor(
      () =>
        music(
          `Math.abs(document.querySelector('video').volume - .44) < .001 && document.querySelector('#ytmusic-plus-volume-percent').textContent === '44%'`,
        ),
      'modern volume survives song reset',
    );
    modernWindow.webContents.send(IPC.playerCommand, {
      id: 'modern-open-queue',
      command: { type: 'openQueue' },
    });
    await waitFor(
      () => music(`document.querySelector('ytmusic-app').playerPageOpen === true`),
      'modern native player page command',
    );
    await music(
      `const slider=document.querySelector('#slider');slider.value='61';slider.dispatchEvent(new Event('input',{bubbles:true}));true`,
    );
    await waitFor(
      async () => Math.abs(modernVolume - 0.61) < 0.001,
      'modern native slider updates saved preference',
    );
    await music(`document.querySelector('.ytMusicMiniPlayerVolumeWrapper button').click();true`);
    await waitFor(
      () =>
        music(
          `document.querySelector('video').muted && document.querySelector('#ytmusic-plus-volume-percent').textContent === '0%'`,
        ),
      'modern mute percentage',
    );
    await captureScreenshot(modernWindow.webContents, join(output, 'modern-native-player.png'));
    console.log(
      'MODERN_PLAYER_OK: native miniplayer; 64px height; real mouse wheel; percentage; saved volume; next; native slider; mute; player page',
    );
  } finally {
    ipcMain.removeListener(IPC.musicState, modernState);
    ipcMain.removeListener(IPC.volumePreference, modernPreference);
    modernWindow?.destroy();
    await session.protocol.unhandle('https');
  }

  await desktop.music.webContents.executeJavaScript(
    `location.assign('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F');true`,
  );
  let account: BrowserWindow | undefined;
  await waitFor(async () => {
    account = BrowserWindow.getAllWindows().find(
      (window) =>
        window !== desktop.window &&
        window.webContents.getURL().startsWith('https://accounts.google.com/'),
    );
    return !!account && !account.webContents.isLoading();
  }, 'Google account window');
  if (!account) throw new Error('Account window was not created');
  const isolated = await account.webContents.executeJavaScript(
    '({ready: document.readyState, require: typeof require, bridge: typeof window.ytmusic})',
  );
  if (isolated.require !== 'undefined' || isolated.bridge !== 'undefined')
    throw new Error('Account page received privileged APIs');
  if (desktop.music.webContents.getURL() !== fixtureURL)
    throw new Error('Sign-in replaced the music page');
  const music = (expression: string) =>
    desktop.music.webContents.executeJavaScript(expression) as Promise<boolean>;
  if (!(await music('!!document.querySelector("#ytmusic-plus-volume-percent")')))
    throw new Error('Intercepted sign-in navigation removed the percentage display');
  await music(
    'document.querySelector(".title").dispatchEvent(new WheelEvent("wheel",{deltaY:-120,cancelable:true,bubbles:true}));true',
  );
  await waitFor(
    () =>
      music(
        'Math.abs(document.querySelector("audio").volume - .44) < .001 && document.querySelector("#ytmusic-plus-volume-percent").textContent === "44%"',
      ),
    'wheel remains active after canceled sign-in navigation',
  );
  await captureScreenshot(account, join(output, 'sign-in.png'));
  account.close();
  console.log(
    'AUTH_OK: intercepted sign-in preserves volume percentage and wheel controls; separate secure Google window responsive (no credentials submitted)',
  );
}
