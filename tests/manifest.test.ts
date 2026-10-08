import { describe, expect, it } from 'vitest';
import { validateManifest, requirePermission } from '../src/shared/types/plugin';
import { pluginCallSchema } from '../src/shared/types/plugin-rpc';
import { manifestDigest } from '../src/main/plugins/manifest-digest';

const valid = {
  id: 'test-plugin',
  name: 'Test',
  version: '1.0.0',
  description: 'Test plugin',
  author: 'Test',
  main: 'index.js',
  permissions: ['player.read'],
  ytmusicPlus: '>=1.0.0',
};
describe('plugin manifests and grants', () => {
  it('requires unique permissions, safe entry points and compatible versions', () => {
    expect(validateManifest(valid).id).toBe('test-plugin');
    for (const override of [
      { id: '../escape' },
      { main: '../index.js' },
      { version: 'latest' },
      { permissions: ['shell'] },
      { permissions: ['player.read', 'player.read'] },
      { ytmusicPlus: '>=2.0.0' },
    ])
      expect(() => validateManifest({ ...valid, ...override })).toThrow();
  });
  it('requires declared network domains and explicit permission grants', () => {
    expect(() => validateManifest({ ...valid, permissions: ['network'] })).toThrow(
      'networkDomains',
    );
    const manifest = validateManifest(valid);
    expect(() => requirePermission(manifest, [], 'player.read')).toThrow();
    expect(() => requirePermission(manifest, ['player.control'], 'player.control')).toThrow();
    expect(() => requirePermission(manifest, ['player.read'], 'player.read')).not.toThrow();
  });
  it('invalidates a grant digest when domains or permissions change', () => {
    const first = validateManifest({
      ...valid,
      permissions: ['network'],
      networkDomains: ['lrclib.net'],
    });
    const changed = validateManifest({ ...first, networkDomains: ['example.com'] });
    expect(manifestDigest(first)).not.toBe(manifestDigest(changed));
  });
  it('rejects arbitrary RPC methods and unsafe values', () => {
    expect(pluginCallSchema.safeParse({ type: 'shell', command: 'anything' }).success).toBe(false);
    expect(
      pluginCallSchema.safeParse({
        type: 'player.command',
        command: { type: 'seek', value: Infinity },
      }).success,
    ).toBe(false);
    expect(
      pluginCallSchema.safeParse({ type: 'filesystem.read', path: 'C:/private' }).success,
    ).toBe(false);
  });
});
