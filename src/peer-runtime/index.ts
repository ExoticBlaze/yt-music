import { PeerRoomTransport } from '../../client/peer-room-transport';
import { peerCommandSchema, type PeerCommand } from '../shared/types/peer-rooms';
import type { RoomSnapshot } from '../shared/types/rooms';

declare global {
  interface Window {
    peerBridge: {
      onCommand(callback: (value: PeerCommand) => void): void;
      reply(id: string, ok: boolean, error?: string): void;
      state(value: RoomSnapshot): void;
    };
  }
}
const transport = new PeerRoomTransport((value) => window.peerBridge.state(value));
window.peerBridge.onCommand(async (input) => {
  const request = peerCommandSchema.safeParse(input);
  if (!request.success) return;
  const value = request.data;
  try {
    if (value.type === 'host') await transport.startHost(value.name);
    else if (value.type === 'join') await transport.join(value.invite, value.name);
    else if (value.type === 'send') await transport.send(value.message);
    else await transport.disconnect();
    window.peerBridge.reply(value.id, true);
  } catch (error) {
    window.peerBridge.reply(
      value.id,
      false,
      (error instanceof Error ? error.message : String(error)).slice(0, 500),
    );
  }
});
