import { webFrame } from 'electron';
import type { TrackInfo } from '../../shared/types/music';

interface QueueItemData {
  videoId?: string;
  selected?: boolean;
  title?: { runs?: { text?: string }[] };
  shortBylineText?: { runs?: { text?: string }[] };
  longBylineText?: {
    runs?: {
      text?: string;
      navigationEndpoint?: {
        browseEndpoint?: {
          browseId?: string;
          browseEndpointContextSupportedConfigs?: {
            browseEndpointContextMusicConfig?: { pageType?: string };
          };
        };
      };
    }[];
  };
  lengthText?: { runs?: { text?: string }[] };
  thumbnail?: { thumbnails?: { url?: string }[] };
  navigationEndpoint?: { watchEndpoint?: { videoId?: string; playlistId?: string } };
}

export interface SiteState {
  title?: string;
  artist?: string;
  artistUrl?: string;
  album?: string;
  artwork?: string;
  videoId?: string;
  duration?: number;
  position?: number;
  playing?: boolean;
  buffering?: boolean;
  ad?: boolean;
  account: 'unknown' | 'signedIn' | 'signedOut';
  queue?: TrackInfo[];
}

// Read only bounded song metadata and a login boolean in the page's world.
// Polymer/player properties are not visible from the isolated preload world.
function inspectSite(): SiteState {
  const page = window as unknown as { ytcfg?: { get(key: string): unknown } };
  const api = document.querySelector('#movie_player') as
    | (Element & {
        getVideoData?(): { title?: string; author?: string; video_id?: string };
        getDuration?(): number;
        getCurrentTime?(): number;
        getPlayerState?(): number;
      })
    | null;
  const data = api?.getVideoData?.();
  const metadata = navigator.mediaSession?.metadata;
  const loggedIn = page.ytcfg?.get('LOGGED_IN');
  const nav = document.querySelector('ytmusic-nav-bar');
  const account =
    typeof loggedIn === 'boolean'
      ? loggedIn
        ? 'signedIn'
        : 'signedOut'
      : nav?.querySelector('.sign-in-link')
        ? 'signedOut'
        : nav?.querySelector('#avatar-btn, .avatar-button, ytmusic-avatar-stack-renderer')
          ? 'signedIn'
          : 'unknown';
  const short = (value: unknown, length = 500) =>
    typeof value === 'string' ? value.slice(0, length).trim() : undefined;
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(86400, value))
      : undefined;
  const state = api?.getPlayerState?.();
  const queueElements = [...document.querySelectorAll('ytmusic-player-queue-item')].slice(0, 500);
  const queue: TrackInfo[] = queueElements.map((element) => {
    const item = (element as Element & { data?: QueueItemData }).data;
    const runs = item?.longBylineText?.runs ?? [];
    const artistRun =
      runs.find(
        (run) =>
          run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST',
      ) ?? runs.find((run) => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    const artistId = artistRun?.navigationEndpoint?.browseEndpoint?.browseId;
    const durationText =
      item?.lengthText?.runs?.map((run) => run.text ?? '').join('') ??
      element.querySelector('.duration')?.textContent ??
      '';
    const parts = durationText.trim().split(':').map(Number);
    const seconds =
      parts.length >= 2 && parts.every(Number.isFinite)
        ? parts.reduce((total, value) => total * 60 + value, 0)
        : 0;
    const id = item?.videoId || item?.navigationEndpoint?.watchEndpoint?.videoId;
    const playlist = item?.navigationEndpoint?.watchEndpoint?.playlistId;
    return {
      title:
        short(
          item?.title?.runs?.map((run) => run.text ?? '').join('') ||
            element.querySelector('.song-title,.title')?.textContent,
        ) ?? '',
      artist:
        short(
          item?.shortBylineText?.runs?.map((run) => run.text ?? '').join('') ||
            artistRun?.text ||
            element.querySelector('.byline')?.textContent,
        ) ?? '',
      artistUrl:
        artistId && /^[\w-]{1,200}$/.test(artistId)
          ? `https://music.youtube.com/channel/${artistId}`
          : undefined,
      videoId: id && /^[\w-]{11}$/.test(id) ? id : undefined,
      playlistId: playlist && /^[\w-]{1,200}$/.test(playlist) ? playlist : undefined,
      duration: number(seconds) ?? 0,
      position: 0,
      artwork: short(item?.thumbnail?.thumbnails?.[0]?.url, 2048),
    };
  });
  const current = queue.find((track) => track.videoId === data?.video_id);
  const artistLink = document.querySelector<HTMLAnchorElement>(
    ':is(ytmusic-player-bar, ytmusic-miniplayer) :is(.byline, .ytmusicTrackInfoByline) a:is([href*="channel/"], [href*="browse/"])',
  )?.href;
  return {
    title: short(data?.title || metadata?.title),
    artist: short(
      metadata?.title === data?.title
        ? metadata?.artist || data?.author
        : data?.author || metadata?.artist,
    ),
    artistUrl: current?.artistUrl || artistLink,
    album: !data?.title || metadata?.title === data.title ? short(metadata?.album) : undefined,
    artwork:
      !data?.title || metadata?.title === data.title
        ? short(metadata?.artwork?.[0]?.src, 2048)
        : undefined,
    videoId: short(data?.video_id, 11),
    duration: number(api?.getDuration?.()),
    position: number(api?.getCurrentTime?.()),
    playing: typeof state === 'number' && state >= 0 ? state === 1 : undefined,
    buffering: state === 3,
    ad: api?.classList.contains('ad-showing') ?? false,
    account,
    queue,
  };
}

export async function readSiteState(): Promise<SiteState> {
  return webFrame.executeJavaScript(`(${inspectSite.toString()})()`);
}
