import { z } from 'zod';

export const crossfadeConfigSchema = z.object({
  enabled: z.boolean(),
  seconds: z.number().int().min(0).max(12),
});
export type CrossfadeConfig = z.infer<typeof crossfadeConfigSchema>;
export interface CrossfadeStatus extends CrossfadeConfig {
  phase: 'off' | 'waiting' | 'preparing' | 'ready' | 'crossfading';
  message?: string;
}

// Internal audio commands contain no URLs, scripts, samples or page objects.
export const audioGainRequestSchema = z.object({
  id: z.string().uuid(),
  gain: z.number().finite().min(0).max(1).optional(),
  seconds: z.number().finite().min(0).max(12).default(0),
  curve: z.enum(['in', 'out']).default('in'),
  secondary: z.boolean().optional(),
});
export type AudioGainRequest = z.input<typeof audioGainRequestSchema>;
export const audioGainStatusSchema = z.object({
  supported: z.boolean(),
  ready: z.boolean(),
  playing: z.boolean(),
  gain: z.number().finite().min(0).max(1),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().min(0).max(86400),
  reason: z.string().max(200).optional(),
});
export type AudioGainStatus = z.infer<typeof audioGainStatusSchema>;
export const audioGainReplySchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  status: audioGainStatusSchema.optional(),
  error: z.string().max(500).optional(),
});
