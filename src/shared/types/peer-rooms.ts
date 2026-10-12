import { z } from 'zod';
import { roomClientMessageSchema } from './rooms';

export const peerInviteSchema = z.object({
  kind: z.literal('peerjs'),
  peerId: z.string().regex(/^ytmp-[a-f0-9-]{36}$/),
  code: z.string().regex(/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/),
  secret: z.string().regex(/^[a-f0-9]{32}$/),
});
export type PeerInvite = z.infer<typeof peerInviteSchema>;
export const peerCommandSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), type: z.literal('host'), name: z.string().min(1).max(40) }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('join'),
    name: z.string().min(1).max(40),
    invite: peerInviteSchema,
  }),
  z.object({ id: z.string().uuid(), type: z.literal('send'), message: roomClientMessageSchema }),
  z.object({ id: z.string().uuid(), type: z.literal('disconnect') }),
]);
export type PeerCommand = z.infer<typeof peerCommandSchema>;
export type PeerRequest = PeerCommand extends infer T
  ? T extends PeerCommand
    ? Omit<T, 'id'>
    : never
  : never;
export const peerHelloSchema = z.object({
  type: z.literal('hello'),
  secret: z.string().regex(/^[a-f0-9]{32}$/),
  message: roomClientMessageSchema,
});
