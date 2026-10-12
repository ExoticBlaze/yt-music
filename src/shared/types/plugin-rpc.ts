import { z } from 'zod';
import { playerCommandSchema } from './music';
import { contributionSchema, panelSchema } from './ui';
import { roomClientMessageSchema } from './rooms';
import { crossfadeConfigSchema } from './crossfade';

const key = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/);
export const pluginCallSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player.state') }),
  z.object({ type: z.literal('player.command'), command: playerCommandSchema }),
  z.object({ type: z.literal('queue.read') }),
  z.object({ type: z.literal('queue.play'), index: z.number().int().min(0).max(499) }),
  z.object({ type: z.literal('storage.get'), key }),
  z.object({ type: z.literal('storage.set'), key, value: z.json() }),
  z.object({ type: z.literal('storage.remove'), key }),
  z.object({ type: z.literal('settings.read') }),
  z.object({ type: z.literal('settings.appearance'), value: z.record(z.string(), z.json()) }),
  z.object({ type: z.literal('ui.panel'), panel: panelSchema }),
  z.object({ type: z.literal('ui.remove'), id: key }),
  z.object({ type: z.literal('ui.open'), id: key }),
  z.object({ type: z.literal('ui.contribution'), contribution: contributionSchema }),
  z.object({ type: z.literal('ui.toast'), text: z.string().max(500) }),
  z.object({ type: z.literal('ui.css'), css: z.string().max(100000) }),
  z.object({
    type: z.literal('network.fetch'),
    url: z.string().url().max(2048),
    options: z
      .object({
        method: z.enum(['GET', 'POST']).optional(),
        body: z.string().max(65536).optional(),
        headers: z.record(z.string(), z.string().max(1000)).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('notification'),
    title: z.string().max(100),
    body: z.string().max(500),
  }),
  z.object({ type: z.literal('clipboard'), text: z.string().max(10000) }),
  z.object({
    type: z.literal('filesystem.import'),
    extensions: z.array(z.string().regex(/^[a-z]{1,10}$/)).max(10),
  }),
  z.object({
    type: z.literal('presence'),
    clientId: z.string().regex(/^\d{17,22}$/),
    activity: z
      .object({
        details: z.string().max(128).optional(),
        state: z.string().max(128).optional(),
        timestamps: z
          .object({ start: z.number().finite().optional(), end: z.number().finite().optional() })
          .optional(),
        assets: z
          .object({
            large_image: z.string().max(2048).optional(),
            large_text: z.string().max(128).optional(),
          })
          .optional(),
        buttons: z
          .array(
            z.object({
              label: z.string().max(32),
              url: z
                .string()
                .url()
                .refine((value) => value.startsWith('https://music.youtube.com/')),
            }),
          )
          .max(2)
          .optional(),
      })
      .nullable(),
  }),
  z.object({ type: z.literal('rooms.send'), message: roomClientMessageSchema }),
  z.object({ type: z.literal('rooms.disconnect') }),
  z.object({ type: z.literal('rooms.startInternet'), name: z.string().min(1).max(40) }),
  z.object({
    type: z.literal('rooms.joinInvite'),
    invite: z.string().max(2048),
    name: z.string().min(1).max(40),
  }),
  z.object({ type: z.literal('blocking.status') }),
  z.object({ type: z.literal('blocking.enable'), enabled: z.boolean() }),
  z.object({ type: z.literal('blocking.update') }),
  z.object({ type: z.literal('crossfade.status') }),
  z.object({ type: z.literal('crossfade.configure'), value: crossfadeConfigSchema }),
  z.object({ type: z.literal('themes.list') }),
  z.object({ type: z.literal('themes.select'), id: key }),
  z.object({ type: z.literal('themes.import') }),
  z.object({ type: z.literal('log'), message: z.string().max(2000) }),
]);
export type PluginCall = z.input<typeof pluginCallSchema>;
