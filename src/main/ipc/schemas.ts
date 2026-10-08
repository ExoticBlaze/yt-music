import { z } from 'zod';
import { playerCommandSchema } from '../../shared/types/music';
import { settingsSchema } from '../../shared/types/settings';

const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,150}$/);
export const appRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('toast'), text: z.string().max(500) }),
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('signIn') }),
  z.object({ type: z.literal('signOut') }),
  z.object({ type: z.literal('player'), command: playerCommandSchema }),
  z.object({ type: z.literal('settings'), settings: settingsSchema }),
  z.object({
    type: z.literal('view'),
    view: z.enum(['music', 'plugins', 'settings', 'debug', 'palette']),
  }),
  z.object({ type: z.literal('panel'), pluginId: id, id }),
  z.object({
    type: z.literal('pluginAction'),
    pluginId: id,
    action: id,
    value: z.union([z.string().max(100000), z.number().finite(), z.boolean()]).optional(),
  }),
  z.object({ type: z.literal('command'), id }),
  z.object({
    type: z.literal('plugin'),
    id,
    action: z.enum(['enable', 'disable', 'reload', 'uninstall', 'inspect', 'folder']),
  }),
  z.object({ type: z.literal('install'), source: z.enum(['zip', 'folder']) }),
  z.object({
    type: z.literal('developer'),
    action: z.enum([
      'reloadPlugins',
      'devtools',
      'musicDevtools',
      'exportLogs',
      'pluginsFolder',
      'importCss',
      'checkUpdates',
    ]),
  }),
  z.object({ type: z.literal('layout'), mode: z.enum(['none', 'panel', 'full']) }),
  z.object({
    type: z.literal('navigation'),
    action: z.enum(['back', 'forward', 'reload', 'home']),
  }),
  z.object({ type: z.literal('window'), action: z.enum(['minimize', 'maximize', 'close']) }),
]);
