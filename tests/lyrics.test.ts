import { describe, expect, it, vi } from 'vitest';
import { parseLRC } from '../plugins/lyrics/src/lrc';
import { trackKey, LRCLibProvider } from '../plugins/lyrics/src/providers';
import type { PluginContext } from '../plugin-sdk/index';

describe('lyrics', () => {
  it('parses repeated timestamps, fractions, offsets and rejects invalid seconds', () => {
    const source =
      '[ar:Artist]\n[offset:100]\n[01:02.50][02:03.125]Words\n[00:99]Invalid\n[00:05]First';
    expect(parseLRC(source)).toEqual([
      { time: 4.9, text: 'First' },
      { time: 62.4, text: 'Words' },
      { time: 123.025, text: 'Words' },
    ]);
  });
  it('uses identifying metadata for cache keys', () => {
    const track = {
      title: ' Song ',
      artist: ' ARTIST ',
      album: 'Album',
      duration: 180.2,
      position: 5,
    };
    expect(trackKey(track)).toBe(
      trackKey({ ...track, title: 'song', artist: 'artist', position: 60 }),
    );
    expect(trackKey(track)).not.toBe(trackKey({ ...track, album: 'Live' }));
  });
  it('searches when album metadata is missing and rejects a different recording', async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify([
        {
          trackName: 'Song',
          artistName: 'Other artist',
          duration: 180,
          syncedLyrics: '[00:01]Wrong artist',
        },
        {
          trackName: 'Song',
          artistName: 'Artist',
          duration: 240,
          syncedLyrics: '[00:01]Live version',
        },
        {
          trackName: 'Song',
          artistName: 'Artist',
          duration: 181,
          syncedLyrics: '[00:01]Right song',
        },
      ]),
    });
    const provider = new LRCLibProvider({ network: { fetch } } as unknown as PluginContext);
    expect(
      await provider.search({ title: 'Song', artist: 'Artist', duration: 180, position: 0 }),
    ).toMatchObject({ synced: true, lines: [{ time: 1, text: 'Right song' }] });
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe('/api/search');
  });
  it('falls back from an unsuccessful exact lookup to search', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '[]' });
    const provider = new LRCLibProvider({ network: { fetch } } as unknown as PluginContext);
    expect(
      await provider.search({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        position: 0,
      }),
    ).toBeNull();
    expect(fetch.mock.calls.map((call) => new URL(call[0]).pathname)).toEqual([
      '/api/get',
      '/api/search',
    ]);
  });
  it('keeps provider failures visible', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 503, body: '' });
    const provider = new LRCLibProvider({ network: { fetch } } as unknown as PluginContext);
    await expect(
      provider.search({ title: 'Song', artist: 'Artist', duration: 180, position: 0 }),
    ).rejects.toThrow('HTTP 503');
  });
});
