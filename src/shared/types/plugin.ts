import { z } from 'zod';
import semver from 'semver';
import { APP_VERSION } from '../constants/version';

export const permissions = [
  'player.read',
  'player.control',
  'queue.read',
  'queue.modify',
  'ui.inject',
  'ui.overlay',
  'settings.read',
  'settings.write',
  'network',
  'notifications',
  'clipboard',
  'filesystem',
  'presence',
  'rooms',
  'web.blocking',
  'audio.crossfade',
] as const;
export type Permission = (typeof permissions)[number];
export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(80),
  version: z.string().refine((value) => !!semver.valid(value), 'Invalid semantic version'),
  description: z.string().max(1000),
  author: z.string().min(1).max(100),
  main: z
    .string()
    .regex(/^[a-zA-Z0-9_./-]+\.js$/)
    .refine((value) => !value.startsWith('/') && !value.split('/').includes('..')),
  permissions: z
    .array(z.enum(permissions))
    .max(permissions.length)
    .refine((value) => new Set(value).size === value.length, 'Duplicate permission'),
  networkDomains: z
    .array(z.string().regex(/^(?!.*\.\.)(?:[a-z0-9-]+\.)+[a-z]{2,}$/))
    .max(20)
    .default([]),
  ytmusicPlus: z
    .string()
    .refine((value) => !!semver.validRange(value))
    .default('>=1.0.0'),
  icon: z
    .enum(['lyrics', 'rooms', 'discord', 'theme', 'code', 'puzzle', 'shield', 'crossfade'])
    .default('puzzle'),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginStatus = 'disabled' | 'starting' | 'enabled' | 'error';
export interface PluginInfo {
  manifest: PluginManifest;
  builtin: boolean;
  status: PluginStatus;
  error?: string;
  granted: Permission[];
}
export function validateManifest(input: unknown, appVersion = APP_VERSION): PluginManifest {
  const manifest = pluginManifestSchema.parse(input);
  if (!semver.satisfies(appVersion, manifest.ytmusicPlus))
    throw new Error(`Plugin requires YTMusic+ ${manifest.ytmusicPlus}`);
  if (manifest.permissions.includes('network') && !manifest.networkDomains.length)
    throw new Error('Network permission requires explicit networkDomains');
  return manifest;
}
export function requirePermission(
  manifest: PluginManifest,
  grants: readonly string[],
  permission: Permission,
): void {
  if (!manifest.permissions.includes(permission) || !grants.includes(permission))
    throw new Error(`Permission denied: ${permission}`);
}
