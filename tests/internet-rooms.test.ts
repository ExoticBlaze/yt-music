import { describe, expect, it, vi } from 'vitest';
import { RoomService } from '../src/main/networking/room-service';
import { settingsSchema } from '../src/shared/types/settings';
import type { Logger } from '../src/main/logging/logger';
import { emptyRoom } from '../src/shared/types/room-state';
import type { RoomSnapshot } from '../src/shared/types/rooms';
import {
  createRoomInvite,
  createPeerInvite,
  parseRoomInvite,
} from '../src/shared/types/room-invite';
import type { PeerInvite } from '../src/shared/types/peer-rooms';
import { WebSocketRoomTransport } from '../client/websocket-transport';

const invitation: PeerInvite = {
  kind: 'peerjs',
  peerId: 'ytmp-12345678-1234-4234-8234-123456789abc',
  code: 'ABC-123',
  secret: 'a'.repeat(32),
};
const logger = { log() {} } as unknown as Logger;
const defaults = () => settingsSchema.parse({});

describe('internet room invitations', () => {
  it('round-trips a private PeerJS invite and retains legacy secure relay invites', () => {
    expect(parseRoomInvite(createPeerInvite(invitation))).toEqual(invitation);
    const relay = 'wss://rooms.example.com/sync?key=CaseSensitive';
    expect(parseRoomInvite(createRoomInvite(relay, 'ABC-123'))).toEqual({
      kind: 'relay',
      relay,
      code: 'ABC-123',
    });
  });
  it('rejects malformed, duplicate and insecure invite fields', () => {
    const invite = createPeerInvite(invitation);
    for (const value of [
      'ABC-123',
      'https://music.youtube.com',
      invite.replace(invitation.secret, 'bad'),
      `${invite}&secret=${invitation.secret}`,
      `${invite}&relay=wss://example.com`,
      'ytmusic-plus://room?peer=wrong&code=ABC123&secret=' + 'a'.repeat(32),
      'ytmusic-plus://room?relay=ws://example.com&code=ABC123',
      'ytmusic-plus://room?relay=wss://user:pass@example.com&code=ABC123',
      'ytmusic-plus://room?relay=wss://localhost&code=ABC123',
      'ytmusic-plus://room?relay=wss://example.com&code=ABC123&code=XYZ456',
      `${invite}#extra`,
    ])
      expect(() => parseRoomInvite(value)).toThrow('complete YTMusic+ invite');
  });
  it('still joins a legacy relay invite without changing settings', async () => {
    const settings = defaults();
    const send = vi.spyOn(WebSocketRoomTransport.prototype, 'send').mockResolvedValue();
    const service = new RoomService(() => settings, logger);
    try {
      await service.joinInvite(
        'listener',
        createRoomInvite('wss://example.com/', 'ABC-123'),
        'Friend',
        () => {},
      );
      expect(send).toHaveBeenCalledExactlyOnceWith({
        type: 'join',
        code: 'ABC-123',
        name: 'Friend',
      });
      expect(settings.rooms.server).toBe('ws://127.0.0.1:8787');
    } finally {
      await service.close();
      send.mockRestore();
    }
  });
});

describe('managed P2P sessions', () => {
  it('deduplicates host clicks, routes controls through WebRTC, and cleans up', async () => {
    const startHost = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(() => ({ startHost, send, close, join: vi.fn() }));
    const service = new RoomService(defaults, logger, factory);
    try {
      const started = service.startInternet('host', 'Host', () => {});
      expect(service.startInternet('host', 'Host', () => {})).toBe(started);
      await started;
      await service.send('host', { type: 'seek', position: 12, timestamp: 1 }, () => {});
      expect(startHost).toHaveBeenCalledExactlyOnceWith('Host');
      expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'seek', position: 12, timestamp: 1 });
      await service.disconnect('host');
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await service.close();
    }
  });
  it('uses the peer invite directly and keeps stale snapshots out after leaving', async () => {
    let updated!: (value: RoomSnapshot) => void;
    const join = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = new RoomService(defaults, logger, (callback) => {
      updated = callback;
      return { join, close, startHost: vi.fn(), send: vi.fn() };
    });
    const update = vi.fn();
    try {
      await service.joinInvite('friend', createPeerInvite(invitation), 'Friend', update);
      expect(join).toHaveBeenCalledExactlyOnceWith(invitation, 'Friend');
      await service.disconnect('friend');
      updated({ ...emptyRoom(), code: invitation.code });
      expect(update).not.toHaveBeenCalled();
    } finally {
      await service.close();
    }
  });
  it('cancels pending startup and discards a late success', async () => {
    let resolve!: () => void;
    const startHost = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const service = new RoomService(defaults, logger, () => ({
      startHost,
      close,
      join: vi.fn(),
      send: vi.fn(),
    }));
    const pending = service.startInternet('host', 'Host', () => {});
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(startHost).toHaveBeenCalledTimes(1));
    await service.disconnect('host');
    resolve();
    await rejected;
    expect(close).toHaveBeenCalledTimes(1);
    await service.close();
  });
  it('cleans up failures and supports another startup attempt', async () => {
    const startHost = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = new RoomService(defaults, logger, () => ({
      startHost,
      close,
      join: vi.fn(),
      send: vi.fn(),
    }));
    try {
      await expect(service.startInternet('host', 'Host', () => {})).rejects.toThrow('Offline');
      expect(close).toHaveBeenCalledTimes(1);
      await service.startInternet('host', 'Host', () => {});
      expect(startHost).toHaveBeenCalledTimes(2);
    } finally {
      await service.close();
    }
  });
});
