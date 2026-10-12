import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Peer, DataConnection } from 'peerjs';
import {
  PeerRoomTransport,
  authorizePeerHello,
  decodePeerData,
} from '../client/peer-room-transport';
import { parseRoomInvite } from '../src/shared/types/room-invite';
import type { PeerInvite } from '../src/shared/types/peer-rooms';
import type { RoomSnapshot } from '../src/shared/types/rooms';

const peers = new Map<string, FakePeer>();
class FakeConnection extends EventEmitter {
  open = false;
  other?: FakeConnection;
  label = 'ytmusic-plus-room-v1';
  serialization = 'json';
  send(data: string) {
    if (this.open) queueMicrotask(() => this.other?.emit('data', data));
  }
  close() {
    queueMicrotask(() => {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
      if (this.other?.open) {
        this.other.open = false;
        this.other.emit('close');
      }
    });
  }
}
class FakePeer extends EventEmitter {
  connections: FakeConnection[] = [];
  destroyed = false;
  disconnected = false;
  constructor(readonly id: string) {
    super();
    peers.set(id, this);
    queueMicrotask(() => this.emit('open', id));
  }
  connect(id: string) {
    const one = new FakeConnection();
    const two = new FakeConnection();
    one.other = two;
    two.other = one;
    this.connections.push(one);
    const other = peers.get(id);
    if (other) {
      other.connections.push(two);
      queueMicrotask(() => {
        other.emit('connection', two);
        one.open = two.open = true;
        one.emit('open');
        two.emit('open');
      });
    } else queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' }));
    return one as unknown as DataConnection;
  }
  destroy() {
    this.destroyed = true;
    peers.delete(this.id);
    for (const connection of this.connections) connection.close();
    this.emit('close');
  }
}
const factory = (id: string) => new FakePeer(id) as unknown as Peer;
afterEach(() => {
  peers.clear();
  vi.useRealTimers();
});

describe('PeerJS room protocol', () => {
  it('checks the encrypted-channel invite token and bounds incoming data', () => {
    const invite: PeerInvite = {
      kind: 'peerjs',
      peerId: 'ytmp-12345678-1234-4234-8234-123456789abc',
      code: 'ABC-123',
      secret: 'a'.repeat(32),
    };
    const message = { type: 'join', name: 'Friend', code: invite.code };
    expect(authorizePeerHello({ type: 'hello', secret: invite.secret, message }, invite)).toEqual(
      message,
    );
    expect(() =>
      authorizePeerHello({ type: 'hello', secret: 'b'.repeat(32), message }, invite),
    ).toThrow();
    expect(() =>
      authorizePeerHello(
        { type: 'hello', secret: invite.secret, message: { type: 'create', name: 'Bad' } },
        invite,
      ),
    ).toThrow();
    expect(() => decodePeerData('x'.repeat(50001))).toThrow();
    expect(() => decodePeerData({ type: 'join' })).toThrow();
  });
  it('shares state, rejects listener controls, allows a promoted DJ, and ends when the hosting peer leaves', async () => {
    let hostState!: RoomSnapshot;
    let guestState!: RoomSnapshot;
    const host = new PeerRoomTransport((value) => {
      hostState = value;
    }, factory);
    const guest = new PeerRoomTransport((value) => {
      guestState = value;
    }, factory);
    try {
      await host.startHost('Host');
      const invite = parseRoomInvite(hostState.invite!);
      if (invite.kind !== 'peerjs') throw new Error('Expected P2P');
      await guest.join(invite, 'Friend');
      expect(hostState.participants).toHaveLength(2);
      await host.send({ type: 'queue', trackIds: ['abcdefghijk'] });
      await vi.waitFor(() => expect(guestState.playback?.queue).toEqual(['abcdefghijk']));
      await guest.send({ type: 'seek', position: 20, timestamp: 1 });
      await vi.waitFor(() => expect(guestState.error).toContain('role'));
      expect(hostState.playback?.position).toBe(0);
      await host.send({ type: 'promote', participantId: guestState.selfId!, role: 'dj' });
      await guest.send({ type: 'seek', position: 35, timestamp: 1 });
      await vi.waitFor(() => expect(hostState.playback?.position).toBe(35));
      await host.disconnect();
      await vi.waitFor(() => expect(guestState.connection).toBe('Disconnected'));
      expect(guestState.error).toContain('host closed');
    } finally {
      await guest.disconnect();
      await host.disconnect();
    }
  });
  it('resumes the same participant and DJ role after a dropped data connection', async () => {
    let hostState!: RoomSnapshot;
    let guestState!: RoomSnapshot;
    const host = new PeerRoomTransport((value) => {
      hostState = value;
    }, factory);
    const guest = new PeerRoomTransport((value) => {
      guestState = value;
    }, factory);
    try {
      await host.startHost('Host');
      const invite = parseRoomInvite(hostState.invite!);
      if (invite.kind !== 'peerjs') throw new Error('Expected P2P');
      await guest.join(invite, 'Friend');
      const selfId = guestState.selfId!;
      await host.send({ type: 'promote', participantId: selfId, role: 'dj' });
      await vi.waitFor(() =>
        expect(guestState.participants.find((p) => p.id === selfId)?.role).toBe('dj'),
      );
      const hostingPeer = peers.get(invite.peerId)!;
      hostingPeer.connections.at(-1)!.close();
      await vi.waitFor(() => expect(guestState.connection).toBe('Reconnecting'));
      await vi.waitFor(() => expect(guestState.connection).toBe('Connected'), { timeout: 3000 });
      expect(guestState.selfId).toBe(selfId);
      expect(hostState.participants).toHaveLength(2);
      expect(guestState.participants.find((p) => p.id === selfId)?.role).toBe('dj');
    } finally {
      await guest.disconnect();
      await host.disconnect();
    }
  });
});
