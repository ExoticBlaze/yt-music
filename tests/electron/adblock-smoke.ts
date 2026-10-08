import assert from 'node:assert/strict';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { AdBlockService } from '../../src/main/blocking/ad-block-service';
import type { PluginHost } from '../../src/main/plugins/plugin-host';
import type { MusicContext } from '../../src/main/music/context';

async function waitFor(
  test: () => boolean | Promise<boolean>,
  description: string,
  timeout = 20000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      await Promise.resolve()
        .then(test)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Ad blocker timed out: ${description}`);
}

function silentMedia(seconds: number): string {
  const header = Buffer.alloc(44);
  const samples = Buffer.alloc(8000 * seconds, 128);
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
  return `data:audio/wav;base64,${Buffer.concat([header, samples]).toString('base64')}`;
}

function fixture(): string {
  return `<!doctype html><html><body><ytmusic-app></ytmusic-app>
  <ytmusic-player-bar><span class="title">Selected song</span><div class="byline"><a>Test artist</a></div>
  <button class="next-button" onclick="window.nextClicks++">Next</button>
  <div class="volume"><button aria-label="Mute">Mute</button><input id="volume-slider" type="range" min="0" max="1" step=".01" value=".37" oninput="document.querySelector('video').volume=Number(this.value)"></div></ytmusic-player-bar>
  <ytmusic-player-queue><ytmusic-player-queue-item selected></ytmusic-player-queue-item></ytmusic-player-queue>
  <ytmusic-player><div id="movie_player"><video preload="auto" src="${silentMedia(30)}"></video></div></ytmusic-player>
  <script>
  window.payload=()=>({playabilityStatus:{status:'OK'},videoDetails:{videoId:'abcdefghijk'},streamingData:{formats:[{native:true}]},playerAds:[{}],adPlacements:[{}],adSlots:[{}],adBreakHeartbeatParams:'only-ad-data'});
  var ytInitialPlayerResponse=window.payload();
  window.originalConfigSet=function(key,value){if(typeof key==='string')this.data_[key]=value;else Object.assign(this.data_,key)};
  var ytcfg={data_:{},get:()=>false,set:window.originalConfigSet};
  ytcfg.set({PLAYER_VARS:{player_response:JSON.stringify(window.payload())}});
  window.early={installed:!!window[Symbol.for('ytmusic-plus.playback-ad-blocker')],initial:!('adPlacements' in ytInitialPlayerResponse),config:!('adSlots' in JSON.parse(ytcfg.data_.PLAYER_VARS.player_response))};
  window.nextClicks=0;window.startedSong=false;
  const api=document.querySelector('#movie_player'),media=document.querySelector('video');
  api.getVideoData=()=>({video_id:'abcdefghijk',title:'Selected song',author:'Test artist'});
  api.getDuration=()=>30;api.getCurrentTime=()=>media.currentTime;api.getPlayerState=()=>media.paused?2:1;
  document.querySelector('ytmusic-player-queue-item').data={videoId:'abcdefghijk',title:{runs:[{text:'Selected song'}]},lengthText:{runs:[{text:'0:30'}]}};
  window.startAd=async(paused=false)=>{media.pause();window.startedSong=false;api.classList.add('ad-showing');media.src=${JSON.stringify(silentMedia(8))};media.load();await new Promise(resolve=>media.addEventListener('loadedmetadata',resolve,{once:true}));if(!paused)await media.play();};
  media.addEventListener('ended',()=>{if(!api.classList.contains('ad-showing'))return;api.classList.remove('ad-showing');window.startedSong=true;media.src=${JSON.stringify(silentMedia(30))};media.load();media.play();});
  </script></body></html>`;
}

export async function runAdblockSmoke(
  desktop: DesktopWindow,
  blocker: AdBlockService,
  plugins: PluginHost,
  music: MusicContext,
): Promise<void> {
  await plugins.enable('ad-blocker');
  await plugins.disable('crossfade');
  await blocker.enable('ad-blocker', true);
  const contents = desktop.music.webContents;
  contents.setAudioMuted(true);
  const inspect = (code: string) => contents.executeJavaScript(code, true);
  const protocol = contents.session.protocol;
  const url = 'https://music.youtube.com/__ytm-adblock-smoke';
  await protocol.handle('https', (request) => {
    if (request.url === url)
      return new Response(fixture(), {
        headers: {
          'content-type': 'text/html',
          'content-security-policy':
            "default-src 'none'; script-src 'unsafe-inline'; media-src data:; style-src 'unsafe-inline'; connect-src 'self'",
        },
      });
    if (request.url === `${url}/response`)
      return new Response(
        JSON.stringify({
          playabilityStatus: { status: 'OK' },
          playerAds: [{}],
          adPlacements: [{}],
          adSlots: [{}],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    return contents.session.fetch(request, { bypassCustomProtocolHandlers: true });
  });
  try {
    await contents.loadURL(url);
    const early = await inspect('window.early');
    assert.deepEqual(
      early,
      { installed: true, initial: true, config: true },
      'blocker must run before the first inline player configuration',
    );
    assert(
      await inspect(`(async()=>{
      const parsed=JSON.parse(JSON.stringify(window.payload()),(key,value)=>key==='videoId'?'revived':value);
      const response=await fetch('/__ytm-adblock-smoke/response').then(r=>r.json());
      const xhr=await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET','/__ytm-adblock-smoke/response');x.responseType='json';x.onload=()=>resolve(x.response);x.onerror=reject;x.send()});
      let malformed=false;try{JSON.parse('{bad')}catch(e){malformed=e instanceof SyntaxError}
      ytcfg.set('PLAYER_VARS',{player_response:JSON.stringify(window.payload())});
      return !('adSlots' in parsed)&&parsed.videoDetails.videoId==='revived'&&parsed.streamingData.formats[0].native&&
        !('adPlacements' in response)&&!('adSlots' in xhr)&&response.playabilityStatus.status==='OK'&&malformed&&
        !('playerAds' in JSON.parse(ytcfg.data_.PLAYER_VARS.player_response))&&typeof window.ytmusic==='undefined';
    })()`),
      'parsed and fetch responses must preserve native behavior and expose no bridge',
    );
    await waitFor(
      () => blocker.status('ad-blocker').filteredResponses >= 4,
      'filtered-response counts',
    );
    await waitFor(() => inspect('document.querySelector("video").readyState>=2'), 'silent media');
    await desktop.window.webContents.executeJavaScript(
      'window.ytmusic.request({type:"player",command:{type:"setVolume",value:.37}})',
    );
    await inspect('window.startAd(true)');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert(
      await inspect(
        'document.querySelector("video").paused&&document.querySelector("video").currentTime===0&&!window.startedSong',
      ),
      'paused ads must stay paused',
    );
    await inspect('document.querySelector("video").play()');
    await waitFor(
      () =>
        inspect(
          'window.startedSong&&document.querySelector("video").duration===30&&!document.querySelector("video").paused',
        ),
      'ad ended and original song started',
    );
    assert(
      await inspect(
        'window.nextClicks===0&&Math.abs(document.querySelector("video").volume-.37)<.01&&!document.querySelector("video").muted&&document.querySelector("video").playbackRate===1',
      ),
      'ad fallback must retain the original song and volume',
    );
    await waitFor(() => blocker.status('ad-blocker').skippedAds >= 1, 'ad-skipped counts');
    // A stale native ad marker must not finish the selected song itself.
    await inspect(
      'document.querySelector("#movie_player").classList.add("ad-showing");document.querySelector("video").currentTime=3;true',
    );
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert(
      await inspect('document.querySelector("video").currentTime<6&&window.nextClicks===0'),
      'selected-song duration guard',
    );
    await inspect('document.querySelector("#movie_player").classList.remove("ad-showing");true');
    await blocker.enable('ad-blocker', false);
    await waitFor(
      () => inspect(`'adSlots' in JSON.parse(JSON.stringify(window.payload()))`),
      'disable restores JSON parsing',
    );
    assert(
      await inspect(`(async()=>{
      const result=await new Response(JSON.stringify(window.payload())).json();
      const descriptor=Object.getOwnPropertyDescriptor(window,'ytInitialPlayerResponse');
      const xhr=await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET','/__ytm-adblock-smoke/response');x.responseType='json';x.onload=()=>resolve(x.response);x.onerror=reject;x.send()});
      return 'adPlacements' in result&&'adSlots' in xhr&&!descriptor.get&&ytcfg.set===window.originalConfigSet&&JSON.parse.toString().includes('[native code]')&&Response.prototype.json.toString().includes('[native code]');
    })()`),
      'disable restores response parsing and globals',
    );
    await inspect('window.startAd()');
    await new Promise((resolve) => setTimeout(resolve, 1400));
    assert(
      await inspect('!window.startedSong&&document.querySelector("video").currentTime<4'),
      'disabled ad fallback stays off',
    );
    await blocker.enable('ad-blocker', true);
    await waitFor(
      () => inspect('window.startedSong&&!document.querySelector("video").paused'),
      're-enable handles an already loaded pre-roll',
    );
    // The ordinary visible native Skip Ad button is preferred when present.
    await inspect(
      `const skip=document.createElement('button');skip.className='ytp-skip-ad-button';skip.textContent='Skip ad';skip.onclick=()=>{window.nativeSkip=true;document.querySelector('video').currentTime=document.querySelector('video').duration};document.querySelector('#movie_player').append(skip);window.startAd()`,
    );
    await waitFor(() => inspect('window.nativeSkip&&window.startedSong'), 'native skip button');
    await waitFor(() => blocker.status('ad-blocker').skippedAds >= 3, 'aggregate skipped ads');
    console.log(
      'ADBLOCK_FIXTURE_OK: document-start filtering, fetch/JSON/config responses, paused ads, selected song, volume, native skip and enable/disable cleanup',
    );
  } finally {
    protocol.unhandle('https');
  }

  const start = blocker.status('ad-blocker').filteredResponses;
  await contents.loadURL('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  await waitFor(
    () => music.getState().track?.videoId === 'dQw4w9WgXcQ',
    'real song metadata',
    30000,
  );
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"play"}})',
  );
  await waitFor(
    () =>
      music.getState().playing &&
      !music.getState().ad &&
      (music.getState().track?.duration ?? 0) > 100 &&
      (music.getState().track?.position ?? 0) > 1,
    'native song playback past pre-roll',
    35000,
  );
  const status = blocker.status('ad-blocker');
  console.log('ADBLOCK_LIVE_OK: selected YouTube Music song plays through the native player', {
    playerResponsesFiltered: status.filteredResponses - start,
    skippedAds: status.skippedAds,
  });
  // Exercise a second page's initial response, then an in-app queue transition.
  await contents.loadURL('https://music.youtube.com/watch?v=kJQP7kiw5Fk');
  await waitFor(
    () => music.getState().track?.videoId === 'kJQP7kiw5Fk',
    'second real song metadata',
    30000,
  );
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"play"}})',
  );
  await waitFor(
    () =>
      music.getState().playing &&
      !music.getState().ad &&
      (music.getState().track?.position ?? 0) > 1,
    'second native song starts without pre-roll',
    35000,
  );
  console.log('ADBLOCK_SECOND_SONG_OK', {
    playerResponsesFiltered: blocker.status('ad-blocker').filteredResponses - start,
  });
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"openQueue"}})',
  );
  await waitFor(() => music.getState().queue.length > 1, 'real native queue');
  const queuedId = music.getState().queue[1]?.videoId;
  assert(queuedId && queuedId !== 'kJQP7kiw5Fk', 'second native queue song is available');
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"playQueueItem",index:1}})',
  );
  await waitFor(
    () =>
      music.getState().track?.videoId === queuedId &&
      music.getState().playing &&
      !music.getState().ad &&
      (music.getState().track?.position ?? 0) > 1,
    'in-app queue song starts without pre-roll',
    35000,
  );
  console.log('ADBLOCK_QUEUE_TRANSITION_OK', {
    playerResponsesFiltered: blocker.status('ad-blocker').filteredResponses - start,
  });
  await desktop.window.webContents.executeJavaScript(
    'window.ytmusic.request({type:"player",command:{type:"pause"}})',
  );
}
