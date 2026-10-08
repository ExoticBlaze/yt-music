import { z } from 'zod';

export const roomRoleSchema = z.enum(['host', 'dj', 'listener']);
export const participantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  role: roomRoleSchema,
});
export type Participant = z.infer<typeof participantSchema>;
export const roomPlaybackSchema = z.object({
  trackId: z
    .string()
    .regex(/^[\w-]{11}$/)
    .nullable(),
  playlistId: z
    .string()
    .regex(/^[\w-]{1,200}$/)
    .optional(),
  playing: z.boolean(),
  position: z.number().finite().min(0).max(86400),
  timestamp: z.number().finite().nonnegative(),
  queue: z.array(z.string().regex(/^[\w-]{11}$/)).max(500),
  revision: z.number().int().nonnegative(),
});
export type RoomPlayback = z.infer<typeof roomPlaybackSchema>;
export const roomPermissionsSchema = z.object({
  djPlayback: z.boolean(),
  djSeek: z.boolean(),
  djQueue: z.boolean(),
});
export const roomClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), name: z.string().min(1).max(40) }),
  z.object({
    type: z.literal('join'),
    code: z.string().regex(/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/),
    name: z.string().min(1).max(40),
    resumeToken: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal('leave') }),
  z.object({
    type: z.literal('playback-state'),
    trackId: z
      .string()
      .regex(/^[\w-]{11}$/)
      .nullable(),
    playlistId: z
      .string()
      .regex(/^[\w-]{1,200}$/)
      .optional(),
    playing: z.boolean(),
    position: z.number().finite().min(0).max(86400),
    timestamp: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('seek'),
    position: z.number().finite().min(0).max(86400),
    timestamp: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('track-change'),
    trackId: z.string().regex(/^[\w-]{11}$/),
    timestamp: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('queue'),
    trackIds: z.array(z.string().regex(/^[\w-]{11}$/)).max(500),
  }),
  z.object({
    type: z.literal('promote'),
    participantId: z.string().uuid(),
    role: z.enum(['dj', 'listener']),
  }),
  z.object({ type: z.literal('kick'), participantId: z.string().uuid() }),
  z.object({ type: z.literal('permissions'), permissions: roomPermissionsSchema }),
  z.object({ type: z.literal('ping'), sentAt: z.number().finite().nonnegative() }),
]);
export type RoomClientMessage = z.infer<typeof roomClientMessageSchema>;
export const roomSnapshotSchema = z.object({
  connection: z.enum(['Connected', 'Synchronizing', 'Out of Sync', 'Reconnecting', 'Disconnected']),
  code: z.string().nullable(),
  selfId: z.string().uuid().nullable(),
  participants: z.array(participantSchema).max(50),
  permissions: roomPermissionsSchema,
  playback: roomPlaybackSchema.nullable(),
  serverTime: z.number().finite(),
  clockOffset: z.number().finite().default(0),
  error: z.string().max(500).optional(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export const roomServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    snapshot: roomSnapshotSchema,
    resumeToken: z.string().uuid(),
  }),
  z.object({ type: z.literal('snapshot'), snapshot: roomSnapshotSchema }),
  z.object({
    type: z.literal('pong'),
    sentAt: z.number().finite(),
    serverTime: z.number().finite(),
  }),
  z.object({ type: z.literal('error'), message: z.string().max(500) }),
]);
export type RoomServerMessage = z.infer<typeof roomServerMessageSchema>;
export { emptyRoom, canControl } from './room-state';
