import { describe, expect, it } from 'vitest';
import { RoomService } from '../src/main/networking/room-service';
import { usesBundledRelay } from '../src/main/networking/local-relay';
import { settingsSchema } from '../src/shared/types/settings';
import type { RoomSnapshot } from '../src/shared/types/rooms';
import type { Logger } from '../src/main/logging/logger';

function roomUpdate(test: (room: RoomSnapshot) => boolean): {
  promise: Promise<RoomSnapshot>;
  update: (room: RoomSnapshot) => void;
} {
  let update = (_room: RoomSnapshot) => {};
  const promise = new Promise<RoomSnapshot>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Room snapshot timed out')), 5000);
    update = (room) => {
      if (test(room)) {
        clearTimeout(timer);
        resolve(room);
      }
    };
  });
  return { promise, update };
}
describe('automatic local relay', () => {
  it('only starts for the default loopback relay', () => {
    expect(usesBundledRelay('ws://127.0.0.1:8787')).toBe(true);
    expect(usesBundledRelay('ws://localhost:8787')).toBe(true);
    expect(usesBundledRelay('wss://friends.example.com')).toBe(false);
    expect(usesBundledRelay('ws://127.0.0.1:9999')).toBe(false);
    expect(
      settingsSchema.parse({ rooms: { server: 'ws://127.0.0.1:8787' } }).rooms.autoStartLocal,
    ).toBe(true);
  });
  it('creates and joins without starting a separate server process', async () => {
    const settings = settingsSchema.parse({});
    const logger = { log() {} } as unknown as Logger;
    const host = new RoomService(() => settings, logger);
    const listener = new RoomService(() => settings, logger);
    try {
      const created = roomUpdate((room) => !!room.code);
      await host.send('test-host', { type: 'create', name: 'Test host' }, created.update);
      const room = await created.promise;
      const joined = roomUpdate((room) => room.participants.length === 2);
      await listener.send(
        'test-listener',
        { type: 'join', name: 'Test listener', code: room.code! },
        joined.update,
      );
      const result = await joined.promise;
      expect(result.code).toBe(room.code);
      expect(result.participants.find((value) => value.id === result.selfId)?.role).toBe(
        'listener',
      );
    } finally {
      await listener.close();
      await host.close();
    }
  });
});
