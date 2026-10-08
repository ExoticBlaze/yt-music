import { captureScreenshot } from './capture';
import { join } from 'node:path';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { MusicContext } from '../../src/main/music/context';
import type { OverlayRegistry } from '../../src/main/plugins/overlay-registry';

async function waitFor(test: () => boolean | Promise<boolean>, description: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (
      await Promise.resolve()
        .then(test)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Live playback timed out: ${description}`);
}

export async function runLivePlayback(
  desktop: DesktopWindow,
  music: MusicContext,
  overlay: OverlayRegistry,
  output: string,
): Promise<void> {
  desktop.music.webContents.setAudioMuted(true);
  await desktop.music.webContents.loadURL('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  // A headless Windows display can stall the site's slide-up animation.
  // Use the app's animation-disabled mode for deterministic control geometry.
  await desktop.music.webContents.insertCSS(
    '* { animation-duration: 0s !important; transition-duration: 0s !important; }',
  );
  await waitFor(() => {
    const state = music.getState();
    return (
      state.track?.videoId === 'dQw4w9WgXcQ' &&
      state.track.title === 'Never Gonna Give You Up' &&
      state.track.duration > 200 &&
      state.playing &&
      state.track.position > 1
    );
  }, 'real song metadata and advancing position');
  const shell = (code: string) =>
    desktop.window.webContents.executeJavaScript(code) as Promise<boolean>;
  const site = (code: string) =>
    desktop.music.webContents.executeJavaScript(code) as Promise<boolean>;
  await site(
    `(()=>{const app=document.querySelector('ytmusic-app');if(app.playerPageOpen)document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.toggle-player-page-button button,.ytmusicTrackInfoTitle)')?.click();return true})()`,
  );
  await waitFor(
    () =>
      site(
        'getComputedStyle(document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)")).visibility === "visible" && document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)").getBoundingClientRect().height === 64 && Math.abs(document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)").getBoundingClientRect().bottom - innerHeight) < 1 && document.querySelector("#ytmusic-plus-volume-percent").getBoundingClientRect().width > 0 && document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.title,.ytmusicTrackInfoTitle)").textContent.includes("Never Gonna Give You Up")',
      ),
    'compact native player with visible volume percentage and real metadata',
  ).catch(async (error) => {
    console.log(
      'NATIVE_LAYOUT_FAILURE',
      await site(
        `(()=>{const bar=document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)'),r=bar?.getBoundingClientRect(),app=document.querySelector('ytmusic-app'),layout=document.querySelector('ytmusic-app-layout');return {tag:bar?.tagName,height:r?.height,bottom:r?.bottom,viewport:innerHeight,visible:bar?getComputedStyle(bar).visibility:null,transform:bar?getComputedStyle(bar).transform:null,cssBottom:bar?getComputedStyle(bar).bottom:null,appOpen:app?.playerPageOpen,layoutState:layout?.getAttribute('player-ui-state'),title:bar?.querySelector('.title,.ytmusicTrackInfoTitle')?.textContent,percent:document.querySelector('#ytmusic-plus-volume-percent')?.textContent}})()`,
      ),
    );
    throw error;
  });
  if (!(await shell('!document.querySelector("#playerbar")')))
    throw new Error('Duplicate custom player remains in the shell');
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#play-pause-button button,.ytmusicPlayerControlsPlayPauseButton button)").click(); true',
  );
  await waitFor(() => !music.getState().playing, 'pause the real website player');
  await shell(
    'window.ytmusic.request({type:"player",command:{type:"seek",value:40}}).then(()=>true)',
  );
  await waitFor(
    () => Math.abs((music.getState().track?.position ?? 0) - 40) < 1,
    'seek the real song',
  );
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#play-pause-button button,.ytmusicPlayerControlsPlayPauseButton button)").click(); true',
  );
  await waitFor(
    () => music.getState().playing && (music.getState().track?.position ?? 0) > 40,
    'resume the real song',
  );
  await waitFor(
    () =>
      overlay
        .get()
        .panels.some(
          (panel) =>
            panel.pluginId === 'lyrics' &&
            panel.nodes.some((node) => node.type === 'lyrics' && node.lines.length > 10),
        ),
    'LRCLIB lyrics for the actual song',
  );
  overlay.open('lyrics', 'lyrics');
  await waitFor(
    () =>
      desktop.music.webContents.executeJavaScript(
        'document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics-active") && document.querySelector("#ytmusic-plus-native-lyrics").getBoundingClientRect().height > 100',
      ),
    'lyrics in the real native tab',
  );
  await captureScreenshot(desktop.music.webContents, join(output, 'native-lyrics.png'));
  overlay.view('music');
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.toggle-player-page-button button,.ytmusicTrackInfoTitle)").click();true',
  );
  await waitFor(
    () => site('!document.querySelector("ytmusic-app").playerPageOpen'),
    'collapse the native player page',
  );
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.toggle-player-page-button button,.ytmusicTrackInfoTitle)").click();true',
  );
  await waitFor(
    () =>
      site(
        'document.querySelector("ytmusic-app").playerPageOpen && document.querySelector("ytmusic-player-page").getAttribute("player-ui-state") === "PLAYER_PAGE_OPEN"',
      ),
    'reopen the full player page from the native bar',
  );
  await site('document.querySelector("#side-panel tp-yt-paper-tab").click();true');
  await waitFor(
    () =>
      site(
        'document.querySelectorAll("ytmusic-player-queue-item").length > 1 && !document.querySelector("#side-panel").hasAttribute("data-ytm-lyrics-active")',
      ),
    'real native Up next queue',
  );
  await captureScreenshot(desktop.window, join(output, 'queue.png'));
  await site(
    `(()=>{if(document.querySelector('ytmusic-app').playerPageOpen)document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.toggle-player-page-button button,.ytmusicTrackInfoTitle)')?.click();return true})()`,
  );
  await shell(
    'window.ytmusic.request({type:"player",command:{type:"setVolume",value:.37}}).then(()=>true)',
  );
  await waitFor(
    () =>
      site(
        'Number(document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#volume-slider,.ytMusicMiniPlayerVolumeWrapper input)").value) === 37 && !document.querySelector("video").muted && document.querySelector("#ytmusic-plus-volume-percent").textContent === "37%"',
      ),
    'real persistent volume',
  );
  const wheelPoint: { x: number; y: number; target: boolean } =
    await desktop.music.webContents.executeJavaScript(
      `(()=>{const bar=document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)'),r=bar.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return {x,y,target:!!document.elementFromPoint(x,y)?.closest(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar)')}})()`,
    );
  if (!wheelPoint.target) throw new Error('A page layer covers the native player bar');
  // Trusted mouse input is exercised on the independent render surface in
  // feature-smoke. This checks the live site's native volume handler and scale.
  await site(
    `document.elementFromPoint(${wheelPoint.x},${wheelPoint.y}).dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}));true`,
  );
  await waitFor(
    () =>
      site(
        'Number(document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#volume-slider,.ytMusicMiniPlayerVolumeWrapper input)").value) === 39 && document.querySelector("#ytmusic-plus-volume-percent").textContent === "39%"',
      ),
    'wheel on the real native bar adjusts volume and percentage',
  );
  const inspectVolume = () =>
    desktop.music.webContents.executeJavaScript(
      `(()=>{const slider=document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#volume-slider,.ytMusicMiniPlayerVolumeWrapper input)'),api=document.querySelector('#movie_player');return {slider:Number(slider?.value),apiVolume:api?.getVolume?.(),media:[...document.querySelectorAll('video,audio')].map(media=>({volume:media.volume,muted:media.muted,paused:media.paused})),percent:document.querySelector('#ytmusic-plus-volume-percent')?.textContent}})()`,
    );
  console.log('NATIVE_VOLUME_BEFORE_TRANSITION', await inspectVolume());
  const queuedId = music.getState().queue[1]?.videoId;
  if (!queuedId) throw new Error('Real queue is missing song IDs');
  await site(
    'document.querySelectorAll("ytmusic-player-queue-item ytmusic-play-button-renderer")[1].click();true',
  );
  await waitFor(
    () => music.getState().track?.videoId === queuedId && music.getState().playing,
    'play a real queued song',
  );
  await waitFor(
    () =>
      site(
        'Number(document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#volume-slider,.ytMusicMiniPlayerVolumeWrapper input)").value) === 39 && document.querySelector("#ytmusic-plus-volume-percent").textContent === "39%" && !document.querySelector("video").muted',
      ).then(
        (native) =>
          native &&
          shell(
            'window.ytmusic.request({type:"snapshot"}).then(value=>Math.abs(value.settings.playback.volume-.39)<.001 && !value.settings.playback.muted)',
          ),
      ),
    'real volume persists between songs',
  ).catch(async (error) => {
    console.log('NATIVE_VOLUME_AFTER_TRANSITION', {
      stateVolume: music.getState().volume,
      native: await inspectVolume(),
    });
    throw error;
  });
  console.log('NATIVE_QUEUE_OK: queued song plays; saved native volume persists');
  await waitFor(
    () =>
      site(
        `!!document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.byline,.ytmusicTrackInfoByline) a[href*="channel/"],:is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.byline,.ytmusicTrackInfoByline) a[href*="browse/"]')`,
      ),
    'native artist link available for actual track',
  );
  await site(
    `document.querySelector(':is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.byline,.ytmusicTrackInfoByline) a[href*="channel/"],:is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.byline,.ytmusicTrackInfoByline) a[href*="browse/"]').click();true`,
  );
  await waitFor(
    () =>
      site(
        'location.pathname.startsWith("/channel/") || location.pathname.startsWith("/browse/") || location.pathname.startsWith("/@")',
      ),
    'artist page navigation',
  );
  await waitFor(
    () => music.getState().track?.videoId === queuedId && music.getState().playing,
    'artist navigation preserves playback',
  );
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(.toggle-player-page-button button,.ytmusicTrackInfoTitle)").click();true',
  );
  await waitFor(
    () => site('document.querySelector("ytmusic-app").playerPageOpen'),
    'player page from an artist page',
  );
  await site(
    'document.querySelector(":is(ytmusic-player-bar,ytmusic-miniplayer):not(.top-player-bar) :is(#play-pause-button button,.ytmusicPlayerControlsPlayPauseButton button)").click(); true',
  );
  console.log(
    'LIVE_PLAYBACK_OK: default bar visible; real metadata/play/pause/seek/lyrics; native queue selection and artist navigation; full native player page; native volume persists between songs and wheel adjustment',
  );
}
