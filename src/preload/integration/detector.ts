import type { PlaybackState, TrackInfo } from '../../shared/types/music';
import { emptyPlayback } from '../../shared/types/playback-state';
import { selectors } from './selectors';
import type { SiteState } from './site-state';

const text = (element: Element | null) => element?.textContent?.trim().slice(0, 500) ?? '';
const seconds = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.min(86400, value!)) : 0;
export function findMedia(): HTMLMediaElement | null {
  const media = [...document.querySelectorAll<HTMLMediaElement>('video, audio')];
  return (
    media.find((value) => !value.paused && !value.ended) ??
    media.find((value) => value.readyState > 0) ??
    media[0] ??
    null
  );
}
export function readPlayback(site?: SiteState): PlaybackState {
  const state = emptyPlayback();
  state.url = location.href.slice(0, 2048);
  const player = document.querySelector(selectors.player);
  const video = findMedia();
  const url = new URL(location.href);
  const title = site?.title || text(player?.querySelector(selectors.title) ?? null);
  const nativeTitle = text(player?.querySelector(selectors.title) ?? null);
  const links = [...(player?.querySelectorAll(`${selectors.byline} a`) ?? [])];
  const videoId = site?.videoId || url.searchParams.get('v');
  const playlistId = url.searchParams.get('list');
  const image =
    site?.ad && videoId && /^[\w-]{11}$/.test(videoId)
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : player?.querySelector<HTMLImageElement>(selectors.artwork)?.src || site?.artwork;
  const duration = seconds(site?.duration || video?.duration);
  const track: TrackInfo = {
    title,
    artist:
      (!site?.ad && nativeTitle === title ? text(links[0] ?? null) : '') ||
      site?.artist ||
      text(links[0] ?? null) ||
      text(player?.querySelector(selectors.byline) ?? null)
        .split('•')[0]
        ?.trim() ||
      '',
    artistUrl: site?.artistUrl,
    album: text(links[1] ?? null) || site?.album || undefined,
    artwork: image?.startsWith('https:') ? image.slice(0, 2048) : undefined,
    duration,
    position: seconds(site?.ad ? 0 : (site?.position ?? video?.currentTime)),
    videoId: videoId && /^[\w-]{11}$/.test(videoId) ? videoId : undefined,
    playlistId: playlistId && /^[\w-]{1,200}$/.test(playlistId) ? playlistId : undefined,
  };
  state.track = title ? track : null;
  state.playing = site?.ad ? false : (site?.playing ?? (!!video && !video.paused && !video.ended));
  state.buffering =
    !site?.ad &&
    (site?.buffering ?? (!!video && !video.paused && !video.ended && video.readyState < 3));
  const nextControl = player?.querySelector(selectors.next);
  const nextButton = nextControl?.querySelector('button') ?? nextControl;
  state.nextAvailable =
    !!nextButton &&
    !nextButton.matches(':disabled, [disabled], [aria-disabled="true"]') &&
    !nextControl?.matches('[disabled], [aria-disabled="true"]');
  state.ad = site?.ad ?? false;
  state.volume = video?.volume ?? 1;
  state.muted = video?.muted ?? false;
  const repeatButton = player?.querySelector(selectors.repeat);
  const repeat = (
    repeatButton?.getAttribute('title') ||
    repeatButton?.getAttribute('aria-label') ||
    ''
  ).toLowerCase();
  state.repeat = repeat.includes('one') ? 'one' : repeat.includes('off') || !repeat ? 'off' : 'all';
  state.shuffle = player?.querySelector(selectors.shuffle)?.getAttribute('aria-pressed') === 'true';
  const like = player?.querySelector(selectors.like);
  state.liked = like ? like.getAttribute('aria-pressed') === 'true' : null;
  state.queue = site?.queue?.length
    ? site.queue
    : [...document.querySelectorAll(selectors.queueItems)].slice(0, 500).map((item) => {
        const anchor = item.querySelector<HTMLAnchorElement>('a[href*="watch?v="]');
        let id: string | null = null;
        try {
          if (anchor)
            id = new URL(anchor.getAttribute('href') ?? '', location.href).searchParams.get('v');
        } catch {
          /* One invalid queue link must not discard the playing song. */
        }
        return {
          title: text(item.querySelector('.song-title, .title')),
          artist: text(item.querySelector('.byline')),
          duration: 0,
          position: 0,
          videoId: id && /^[\w-]{11}$/.test(id) ? id : undefined,
        };
      });
  return state;
}
