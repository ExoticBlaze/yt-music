import { describe, expect, it } from 'vitest';
import { trackSchema } from '../src/shared/types/music';

describe('artist navigation metadata', () => {
  const track = { title: 'Song', artist: 'Artist', duration: 120, position: 0 };
  it('accepts native artist pages and rejects outside origins or non-artist paths', () => {
    expect(
      trackSchema.safeParse({ ...track, artistUrl: 'https://music.youtube.com/channel/UCartist' })
        .success,
    ).toBe(true);
    for (const artistUrl of [
      'https://music.youtube.com.evil.test/channel/UCartist',
      'https://user@music.youtube.com/channel/UCartist',
      'https://music.youtube.com/watch?v=abcdefghijk',
      'javascript:alert(1)',
    ])
      expect(trackSchema.safeParse({ ...track, artistUrl }).success).toBe(false);
  });
});
