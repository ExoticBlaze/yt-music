import WebSocket from 'ws';
import {
  emptyRoom,
  roomServerMessageSchema,
  roomClientMessageSchema,
  type RoomClientMessage,
  type RoomSnapshot,
} from '../src/shared/types/rooms';
import type { RoomTransport } from './room-transport';

export function validateRelayURL(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || !['ws:', 'wss:'].includes(url.protocol))
    throw new Error('Relay must use WebSocket');
  if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Remote relays require wss:// TLS');
  return url.href;
}
export class WebSocketRoomTransport implements RoomTransport {
  private socket?: WebSocket;
  private current = emptyRoom();
  private resumeToken?: string;
  private resume?: Extract<RoomClientMessage, { type: 'join' }>;
  private pending?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private attempt = 0;
  private stopped = false;
  constructor(
    private readonly url: string,
    private readonly updated: (snapshot: RoomSnapshot) => void,
    private readonly log: (message: string) => void = () => {},
  ) {
    validateRelayURL(url);
  }
  snapshot(): RoomSnapshot {
    return structuredClone(this.current);
  }
  private publish(): void {
    this.updated(this.snapshot());
  }
  private connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.pending) return this.pending;
    this.stopped = false;
    this.current.connection = this.resume ? 'Reconnecting' : 'Synchronizing';
    this.publish();
    this.pending = new Promise<void>((resolveConnected, rejectConnected) => {
      const socket = new WebSocket(validateRelayURL(this.url), {
        maxPayload: 100000,
        handshakeTimeout: 8000,
      });
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.terminate();
        rejectConnected(new Error('Room connection timed out'));
      }, 10000);
      socket.on('open', () => {
        clearTimeout(timeout);
        this.attempt = 0;
        this.current.connection = 'Connected';
        this.current.error = undefined;
        this.publish();
        if (this.resume)
          socket.send(JSON.stringify({ ...this.resume, resumeToken: this.resumeToken }));
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
        }, 5000);
        socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
        resolveConnected();
      });
      socket.on('message', (data) => {
        let input: unknown;
        try {
          input = JSON.parse(data.toString());
        } catch {
          this.log('Invalid relay JSON');
          socket.close(1008);
          return;
        }
        const parsed = roomServerMessageSchema.safeParse(input);
        if (!parsed.success) {
          this.log('Invalid relay protocol message');
          socket.close(1008);
          return;
        }
        const message = parsed.data;
        if (message.type === 'welcome' || message.type === 'snapshot') {
          const offset = this.current.clockOffset;
          this.current = { ...message.snapshot, clockOffset: offset };
          if (message.type === 'welcome') {
            this.resumeToken = message.resumeToken;
            if (this.current.code && this.resume) this.resume.code = this.current.code;
          }
          this.publish();
        } else if (message.type === 'pong') {
          this.current.clockOffset = message.serverTime - (message.sentAt + Date.now()) / 2;
        } else {
          this.current.error = message.message;
          this.publish();
        }
      });
      socket.on('error', (error) => {
        this.log(error.message);
        this.current.error = error.message;
        rejectConnected(error);
      });
      socket.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(this.pingTimer);
        this.socket = undefined;
        this.current.connection =
          this.stopped || code === 4003 || !this.resume ? 'Disconnected' : 'Reconnecting';
        this.publish();
        rejectConnected(new Error('Room connection closed'));
        if (!this.stopped && code !== 4003 && this.resume) {
          const delay = Math.min(1000 * 2 ** this.attempt++, 15000);
          this.retryTimer = setTimeout(() => void this.connect().catch(() => {}), delay);
        }
      });
    }).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  async send(input: RoomClientMessage): Promise<void> {
    const message = roomClientMessageSchema.parse(input);
    await this.connect();
    if (message.type === 'create')
      this.resume = { type: 'join', code: 'AAA-AAA', name: message.name };
    if (message.type === 'join') {
      this.resume = message;
      this.resumeToken = message.resumeToken;
    }
    if (message.type === 'leave') {
      this.resume = undefined;
      this.resumeToken = undefined;
    }
    this.socket!.send(JSON.stringify(message));
    if (message.type === 'leave') {
      this.current = emptyRoom();
      this.publish();
    }
  }
  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.resume = undefined;
    this.resumeToken = undefined;
    this.socket?.close();
    this.current = emptyRoom();
    this.publish();
  }
}
