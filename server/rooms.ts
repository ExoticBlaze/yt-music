import {
  canControl,
  type RoomClientMessage,
  type Participant,
  type RoomSnapshot,
  type RoomPlayback,
  type RoomServerMessage,
} from '../src/shared/types/rooms';

export interface RoomSocket {
  readonly readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}
interface Member {
  participant: Participant;
  socket: RoomSocket;
  token: string;
  expiry?: NodeJS.Timeout;
}
interface Room {
  code: string;
  members: Map<string, Member>;
  permissions: RoomSnapshot['permissions'];
  playback: RoomPlayback;
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const maxRooms = 1000;
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private sockets = new Map<RoomSocket, { room: Room; member: Member }>();
  constructor(private readonly now = () => Date.now()) {}
  private send(socket: RoomSocket, message: RoomServerMessage): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  private snapshot(room: Room, member: Member): RoomSnapshot {
    return {
      connection: 'Connected',
      code: room.code,
      selfId: member.participant.id,
      participants: [...room.members.values()].map((value) => value.participant),
      permissions: room.permissions,
      playback: room.playback,
      serverTime: this.now(),
      clockOffset: 0,
    };
  }
  private broadcast(room: Room): void {
    for (const member of room.members.values())
      this.send(member.socket, { type: 'snapshot', snapshot: this.snapshot(room, member) });
  }
  receive(socket: RoomSocket, message: RoomClientMessage): void {
    try {
      if (message.type === 'ping') {
        this.send(socket, { type: 'pong', sentAt: message.sentAt, serverTime: this.now() });
        return;
      }
      if (message.type === 'create') {
        this.leave(socket);
        if (this.rooms.size >= maxRooms) throw new Error('Relay room capacity reached');
        let code: string;
        do {
          const random = Array.from(
            crypto.getRandomValues(new Uint8Array(6)),
            (value) => alphabet[value & 31],
          ).join('');
          code = `${random.slice(0, 3)}-${random.slice(3)}`;
        } while (this.rooms.has(code));
        const room: Room = {
          code,
          members: new Map(),
          permissions: { djPlayback: true, djSeek: true, djQueue: false },
          playback: {
            trackId: null,
            playing: false,
            position: 0,
            timestamp: this.now(),
            queue: [],
            revision: 0,
          },
        };
        this.rooms.set(code, room);
        this.add(room, socket, message.name, 'host');
        return;
      }
      if (message.type === 'join') {
        this.leave(socket);
        const compact = message.code.replace('-', '');
        const code = `${compact.slice(0, 3)}-${compact.slice(3)}`;
        const room = this.rooms.get(code);
        if (!room) throw new Error('Room not found');
        const existing = message.resumeToken
          ? [...room.members.values()].find((value) => value.token === message.resumeToken)
          : undefined;
        if (existing) {
          clearTimeout(existing.expiry);
          this.sockets.delete(existing.socket);
          if (existing.socket !== socket && existing.socket.readyState === 1)
            existing.socket.close(4003, 'Session resumed elsewhere');
          existing.socket = socket;
          existing.expiry = undefined;
          this.sockets.set(socket, { room, member: existing });
          this.send(socket, {
            type: 'welcome',
            snapshot: this.snapshot(room, existing),
            resumeToken: existing.token,
          });
          this.broadcast(room);
          return;
        }
        if (room.members.size >= 50) throw new Error('Room is full');
        this.add(room, socket, message.name, 'listener');
        return;
      }
      if (message.type === 'leave') {
        this.leave(socket);
        return;
      }
      const membership = this.sockets.get(socket);
      if (!membership) throw new Error('Join a room first');
      const { room, member } = membership;
      const authorize = (action: Parameters<typeof canControl>[1]) => {
        if (!canControl(member.participant.role, action, room.permissions))
          throw new Error('Your room role cannot perform that action');
      };
      switch (message.type) {
        case 'playback-state':
          authorize('playback');
          if (message.trackId !== room.playback.trackId) authorize('queue');
          if (message.trackId === room.playback.trackId) {
            const expected =
              room.playback.position +
              (room.playback.playing
                ? Math.max(0, this.now() - room.playback.timestamp) / 1000
                : 0);
            if (Math.abs(message.position - expected) > 1.5) authorize('seek');
          }
          room.playback = {
            ...room.playback,
            trackId: message.trackId,
            playlistId: message.playlistId,
            playing: message.playing,
            position: message.position,
            timestamp: this.now(),
            revision: room.playback.revision + 1,
          };
          break;
        case 'seek':
          authorize('seek');
          room.playback.position = message.position;
          room.playback.timestamp = this.now();
          room.playback.revision++;
          break;
        case 'track-change':
          authorize('queue');
          room.playback.trackId = message.trackId;
          room.playback.playlistId = undefined;
          room.playback.position = 0;
          room.playback.playing = true;
          room.playback.timestamp = this.now();
          room.playback.revision++;
          break;
        case 'queue':
          authorize('queue');
          room.playback.queue = message.trackIds;
          room.playback.revision++;
          break;
        case 'permissions':
          authorize('manage');
          room.permissions = message.permissions;
          break;
        case 'promote': {
          authorize('manage');
          const target = room.members.get(message.participantId);
          if (!target || target.participant.role === 'host')
            throw new Error('Participant cannot be promoted');
          target.participant.role = message.role;
          break;
        }
        case 'kick': {
          authorize('manage');
          const target = room.members.get(message.participantId);
          if (!target || target.participant.role === 'host')
            throw new Error('Participant cannot be removed');
          this.send(target.socket, { type: 'error', message: 'You were removed from the room' });
          this.leave(target.socket);
          target.socket.close(4003, 'Removed by host');
          break;
        }
      }
      this.broadcast(room);
    } catch (error) {
      this.send(socket, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Room request failed',
      });
    }
  }
  private add(room: Room, socket: RoomSocket, name: string, role: Participant['role']): void {
    const member: Member = {
      participant: { id: crypto.randomUUID(), name, role },
      token: crypto.randomUUID(),
      socket,
    };
    room.members.set(member.participant.id, member);
    this.sockets.set(socket, { room, member });
    this.send(socket, {
      type: 'welcome',
      snapshot: this.snapshot(room, member),
      resumeToken: member.token,
    });
    this.broadcast(room);
  }
  disconnect(socket: RoomSocket): void {
    const membership = this.sockets.get(socket);
    if (!membership) return;
    const { member } = membership;
    member.expiry = setTimeout(() => this.leave(socket), 30000);
  }
  leave(socket: RoomSocket): void {
    const membership = this.sockets.get(socket);
    if (!membership) return;
    const { room, member } = membership;
    clearTimeout(member.expiry);
    this.sockets.delete(socket);
    room.members.delete(member.participant.id);
    if (!room.members.size) this.rooms.delete(room.code);
    else {
      if (member.participant.role === 'host') {
        const replacement =
          [...room.members.values()].find((value) => value.socket.readyState === 1) ??
          room.members.values().next().value;
        if (replacement) replacement.participant.role = 'host';
      }
      this.broadcast(room);
    }
  }
  close(): void {
    for (const room of this.rooms.values())
      for (const member of room.members.values()) clearTimeout(member.expiry);
    this.rooms.clear();
    this.sockets.clear();
  }
}
