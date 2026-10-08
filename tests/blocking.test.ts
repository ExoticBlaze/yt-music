import { describe, expect, it } from 'vitest';
import { FiltersEngine } from '@ghostery/adblocker';
import { FALLBACK_FILTERS, shouldBlock } from '../src/main/blocking/rules';
import { pluginCallSchema } from '../src/shared/types/plugin-rpc';
import { validateManifest, requirePermission } from '../src/shared/types/plugin';

describe('ad blocking boundaries', () => {
  const engine = FiltersEngine.parse(FALLBACK_FILTERS);
  it('blocks ad requests on the music page and honors filter exceptions', () => {
    expect(
      shouldBlock(
        engine,
        'https://googleads.g.doubleclick.net/pagead/id',
        'https://music.youtube.com/',
        'xhr',
      ),
    ).toBe(true);
    expect(
      shouldBlock(
        engine,
        'https://music.youtube.com/youtubei/v1/browse',
        'https://music.youtube.com/',
        'xhr',
      ),
    ).toBe(false);
    const exceptions = FiltersEngine.parse(`${FALLBACK_FILTERS}\n@@||doubleclick.net^`);
    expect(
      shouldBlock(exceptions, 'https://doubleclick.net/ad', 'https://music.youtube.com/', 'script'),
    ).toBe(false);
  });
  it('always leaves sign-in, other websites, top-level navigation, and media delivery alone', () => {
    expect(
      shouldBlock(engine, 'https://doubleclick.net/ad', 'https://accounts.google.com/', 'script'),
    ).toBe(false);
    expect(
      shouldBlock(
        engine,
        'https://accounts.google.com/signin',
        'https://music.youtube.com/',
        'xhr',
      ),
    ).toBe(false);
    expect(
      shouldBlock(engine, 'https://doubleclick.net/ad', 'https://example.com/', 'script'),
    ).toBe(false);
    expect(
      shouldBlock(engine, 'https://doubleclick.net/ad', 'https://music.youtube.com/', 'mainFrame'),
    ).toBe(false);
    expect(
      shouldBlock(engine, 'https://doubleclick.net/ad', 'https://music.youtube.com/', 'media'),
    ).toBe(false);
    expect(
      shouldBlock(
        FiltersEngine.parse('||googlevideo.com^'),
        'https://r1.googlevideo.com/videoplayback',
        'https://music.youtube.com/',
        'xhr',
      ),
    ).toBe(false);
  });
  it('requires an explicit blocking grant and validates the limited API', () => {
    const manifest = validateManifest({
      id: 'test-blocker',
      name: 'Blocker',
      author: 'Test',
      version: '1.0.0',
      main: 'index.js',
      description: '',
      permissions: ['web.blocking'],
    });
    expect(() => requirePermission(manifest, [], 'web.blocking')).toThrow('Permission denied');
    expect(() => requirePermission(manifest, ['web.blocking'], 'web.blocking')).not.toThrow();
    expect(pluginCallSchema.safeParse({ type: 'blocking.enable', enabled: 'yes' }).success).toBe(
      false,
    );
    expect(pluginCallSchema.safeParse({ type: 'blocking.enable', enabled: true }).success).toBe(
      true,
    );
  });
});
