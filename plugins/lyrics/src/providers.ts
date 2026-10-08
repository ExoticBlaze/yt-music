import type {
  LyricsProvider,
  LyricsResult,
  PluginContext,
  TrackInfo,
} from '../../../plugin-sdk/index';
import { parseLRC } from './lrc';

export function trackKey(track: TrackInfo): string {
  return JSON.stringify([
    track.artist.trim().toLowerCase(),
    track.title.trim().toLowerCase(),
    track.album?.trim().toLowerCase() ?? '',
    Math.round(track.duration),
  ]);
}
export class LocalLyricsProvider implements LyricsProvider {
  readonly id = 'local';
  readonly name = 'Your LRC files';
  constructor(private readonly context: PluginContext) {}
  async search(track: TrackInfo): Promise<LyricsResult | null> {
    const files = await this.context.storage.get<Record<string, LyricsResult>>('localLyrics');
    return files?.[trackKey(track)] ?? null;
  }
  async import(track: TrackInfo): Promise<boolean> {
    const file = await this.context.filesystem.importText(['lrc', 'txt']);
    if (!file) return false;
    const timed = parseLRC(file.text);
    const result: LyricsResult = {
      provider: this.id,
      synced: timed.length > 0,
      lines: timed.length
        ? timed
        : file.text
            .split(/\r?\n/)
            .slice(0, 2000)
            .map((text) => ({ time: 0, text })),
    };
    const existing =
      (await this.context.storage.get<Record<string, LyricsResult>>('localLyrics')) ?? {};
    existing[trackKey(track)] = result;
    await this.context.storage.set('localLyrics', existing);
    return true;
  }
}
export class LRCLibProvider implements LyricsProvider {
  readonly id = 'lrclib';
  readonly name = 'LRCLIB';
  constructor(private readonly context: PluginContext) {}
  async search(track: TrackInfo): Promise<LyricsResult | null> {
    const url = new URL(
      track.album && track.duration > 0
        ? 'https://lrclib.net/api/get'
        : 'https://lrclib.net/api/search',
    );
    url.searchParams.set('track_name', track.title);
    url.searchParams.set('artist_name', track.artist);
    if (track.album) url.searchParams.set('album_name', track.album);
    if (track.duration) url.searchParams.set('duration', String(Math.round(track.duration)));
    let response = await this.context.network.fetch(url.href);
    if ([400, 404].includes(response.status) && url.pathname === '/api/get') {
      url.pathname = '/api/search';
      url.searchParams.delete('album_name');
      url.searchParams.delete('duration');
      response = await this.context.network.fetch(url.href);
    }
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error(`LRCLIB returned HTTP ${response.status}`);
    let data: unknown = JSON.parse(response.body);
    if (Array.isArray(data)) {
      const normalize = (value: string) =>
        value
          .toLocaleLowerCase()
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
      const candidates = data.filter((value): value is Record<string, unknown> => {
        if (!value || typeof value !== 'object') return false;
        const item = value as Record<string, unknown>;
        return (
          typeof item.trackName === 'string' &&
          typeof item.artistName === 'string' &&
          normalize(item.trackName) === normalize(track.title) &&
          normalize(item.artistName) === normalize(track.artist) &&
          (!track.duration ||
            (typeof item.duration === 'number' && Math.abs(item.duration - track.duration) <= 5))
        );
      });
      candidates.sort((a, b) => {
        const albumA =
          typeof a.albumName === 'string' &&
          !!track.album &&
          normalize(a.albumName) === normalize(track.album)
            ? 1
            : 0;
        const albumB =
          typeof b.albumName === 'string' &&
          !!track.album &&
          normalize(b.albumName) === normalize(track.album)
            ? 1
            : 0;
        return (
          albumB - albumA ||
          Math.abs(Number(a.duration) - track.duration) -
            Math.abs(Number(b.duration) - track.duration) ||
          Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics)
        );
      });
      data = candidates[0];
      if (!data) return null;
    }
    if (!data || typeof data !== 'object') throw new Error('Invalid lyrics response');
    const value = data as Record<string, unknown>;
    if (value.instrumental === true)
      return { provider: this.id, synced: false, instrumental: true, lines: [] };
    const synced = typeof value.syncedLyrics === 'string' ? parseLRC(value.syncedLyrics) : [];
    const plain =
      typeof value.plainLyrics === 'string'
        ? value.plainLyrics
            .split(/\r?\n/)
            .slice(0, 2000)
            .map((text) => ({ time: 0, text }))
        : [];
    return synced.length || plain.length
      ? { provider: this.id, synced: !!synced.length, lines: synced.length ? synced : plain }
      : null;
  }
}
