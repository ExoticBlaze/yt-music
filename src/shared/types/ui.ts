import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/);
const action = z.string().max(150);
export const lyricLineSchema = z.object({
  time: z.number().min(0),
  text: z.string().max(2000),
  translation: z.string().max(2000).optional(),
  romanized: z.string().max(2000).optional(),
});
export type LyricLine = z.infer<typeof lyricLineSchema>;
export const uiNodeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().max(20000),
    tone: z.enum(['normal', 'muted', 'accent', 'error']).optional(),
  }),
  z.object({
    type: z.literal('button'),
    label: z.string().max(100),
    action,
    primary: z.boolean().optional(),
    disabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('input'),
    id: identifier,
    label: z.string().max(100),
    value: z.string().max(100000),
    placeholder: z.string().max(200).optional(),
    action,
    multiline: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('toggle'),
    id: identifier,
    label: z.string().max(100),
    value: z.boolean(),
    action,
  }),
  z.object({
    type: z.literal('range'),
    id: identifier,
    label: z.string().max(100),
    value: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().optional(),
    action,
  }),
  z.object({
    type: z.literal('select'),
    id: identifier,
    label: z.string().max(100),
    value: z.string().max(500),
    options: z.array(z.object({ value: z.string().max(500), label: z.string().max(100) })).max(50),
    action,
  }),
  z.object({
    type: z.literal('lyrics'),
    lines: z.array(lyricLineSchema).max(2000),
    offset: z.number().finite(),
    fontSize: z.number().min(14).max(48),
    align: z.enum(['left', 'center']),
    translation: z.boolean(),
    romanized: z.boolean(),
    seekAction: action.optional(),
  }),
  z.object({
    type: z.literal('participants'),
    participants: z
      .array(
        z.object({
          id: z.string().max(100),
          name: z.string().max(40),
          role: z.enum(['host', 'dj', 'listener']),
        }),
      )
      .max(50),
    promoteAction: action.optional(),
    kickAction: action.optional(),
  }),
  z.object({ type: z.literal('code'), text: z.string().max(100000) }),
  z.object({ type: z.literal('divider') }),
]);
export type UINode = z.infer<typeof uiNodeSchema>;
export const panelSchema = z.object({
  id: identifier,
  title: z.string().max(100),
  subtitle: z.string().max(200).optional(),
  nodes: z.array(uiNodeSchema).max(100),
  kind: z.enum(['panel', 'modal', 'overlay']).default('panel'),
  placement: z.enum(['sidebar', 'native-lyrics']).optional(),
});
export type PanelDefinition = z.input<typeof panelSchema>;
export type PanelData = z.output<typeof panelSchema> & { pluginId: string };
export const contributionSchema = z.object({
  id: identifier,
  label: z.string().max(100),
  icon: z.string().max(40).optional(),
  tooltip: z.string().max(200).optional(),
  action,
  slot: z.enum(['player', 'sidebar', 'menu', 'context', 'command']),
  shortcut: z.string().max(100).optional(),
});
export type Contribution = z.infer<typeof contributionSchema> & { pluginId: string };
export interface OverlayState {
  panels: PanelData[];
  contributions: Contribution[];
  activePanel: string | null;
  activeView: 'music' | 'plugins' | 'settings' | 'debug' | 'palette';
  toast: { id: number; text: string } | null;
}
