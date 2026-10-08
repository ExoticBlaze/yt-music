import { createHash } from 'node:crypto';
import type { PluginManifest } from '../../shared/types/plugin';

export function manifestDigest(manifest: PluginManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
