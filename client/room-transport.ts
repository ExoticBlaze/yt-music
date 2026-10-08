import type { RoomClientMessage, RoomSnapshot } from '../src/shared/types/rooms';

export interface RoomTransport {
  send(message: RoomClientMessage): Promise<void>;
  disconnect(): void;
  snapshot(): RoomSnapshot;
}
