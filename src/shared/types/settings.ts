import { z } from 'zod';

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  general: z
    .object({ closeToTray: z.boolean().default(true), launchAtLogin: z.boolean().default(false) })
    .default({ closeToTray: true, launchAtLogin: false }),
  appearance: z
    .object({
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default('#ff434f'),
      theme: z
        .string()
        .regex(/^[a-z][a-z0-9-]{1,63}$/)
        .default('youtube'),
      themeCss: z.string().max(100000).default(''),
      customCss: z.string().max(100000).default(''),
      cssEnabled: z.boolean().default(false),
      background: z.string().max(2048).default(''),
      blur: z.number().min(0).max(30).default(0),
      animations: z.boolean().default(true),
      transparency: z.number().min(0.6).max(1).default(1),
    })
    .default({
      accent: '#ff434f',
      theme: 'youtube',
      themeCss: '',
      customCss: '',
      cssEnabled: false,
      background: '',
      blur: 0,
      animations: true,
      transparency: 1,
    }),
  playback: z
    .object({
      mediaKeys: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(1),
      muted: z.boolean().default(false),
    })
    .default({ mediaKeys: true, volume: 1, muted: false }),
  notifications: z
    .object({ enabled: z.boolean().default(true), trackChanges: z.boolean().default(false) })
    .default({ enabled: true, trackChanges: false }),
  developer: z
    .object({ enabled: z.boolean().default(false), watchPlugins: z.boolean().default(true) })
    .default({ enabled: false, watchPlugins: true }),
  rooms: z
    .object({
      server: z.string().max(2048).default('ws://127.0.0.1:8787'),
      autoStartLocal: z.boolean().default(true),
      displayName: z.string().min(1).max(40).default('Music lover'),
      ignoreDrift: z.number().min(0.05).max(1).default(0.25),
      seekDrift: z.number().min(0.5).max(10).default(1),
    })
    .default({
      server: 'ws://127.0.0.1:8787',
      autoStartLocal: true,
      displayName: 'Music lover',
      ignoreDrift: 0.25,
      seekDrift: 1,
    }),
  shortcuts: z.record(z.string(), z.string().max(100)).default({
    'app.palette': 'Ctrl+K',
    'app.settings': 'Ctrl+,',
    'app.plugins': 'Ctrl+Shift+P',
    'lyrics.toggle': 'Ctrl+Shift+L',
  }),
  plugins: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean(),
        grants: z.array(z.string()),
        manifestDigest: z.string().optional(),
      }),
    )
    .default({}),
});
export type AppSettings = z.infer<typeof settingsSchema>;
export function migrateSettings(input: unknown): AppSettings {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid settings document');
  const source = input as Record<string, unknown>;
  if (typeof source.version === 'number' && source.version > 1)
    throw new Error('Settings are from a newer YTMusic+ version');
  if (source.version === 0) {
    return settingsSchema.parse({
      ...source,
      version: 1,
      general: { closeToTray: source.closeToTray ?? true, launchAtLogin: false },
    });
  }
  return settingsSchema.parse(source);
}
