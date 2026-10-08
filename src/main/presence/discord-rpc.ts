import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { PresenceActivity } from '../../../plugin-sdk/index';

export function encodeRPC(opcode: number, value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
export class DiscordRPC {
  private socket?: Socket;
  private clientId?: string;
  private buffer = Buffer.alloc(0);
  private pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private onReady?: () => void;
  private onFailure?: (error: Error) => void;
  private operations: Promise<void> = Promise.resolve();
  set(clientId: string, activity: PresenceActivity | null): Promise<void> {
    const operation = this.operations.catch(() => {}).then(() => this.setNow(clientId, activity));
    this.operations = operation;
    return operation;
  }
  private async setNow(clientId: string, activity: PresenceActivity | null): Promise<void> {
    if (!this.socket || this.clientId !== clientId) {
      this.close();
      await this.open(clientId);
    }
    const socket = this.socket;
    if (!socket) throw new Error('Discord is not connected');
    const nonce = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error('Discord did not acknowledge presence'));
      }, 5000);
      this.pending.set(nonce, { resolve, reject, timer });
      socket.write(
        encodeRPC(1, {
          cmd: 'SET_ACTIVITY',
          args: { pid: process.pid, activity: activity ? { ...activity, type: 2 } : null },
          nonce,
        }),
      );
    });
  }
  private async open(clientId: string): Promise<void> {
    let found: Socket | undefined;
    for (let index = 0; index < 10; index++) {
      const directory = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? tmpdir();
      const path =
        process.platform === 'win32'
          ? `\\\\?\\pipe\\discord-ipc-${index}`
          : join(directory, `discord-ipc-${index}`);
      found = await new Promise<Socket | undefined>((resolve) => {
        const socket = connect(path);
        const timer = setTimeout(() => {
          socket.destroy();
          resolve(undefined);
        }, 300);
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve(socket);
        });
        socket.once('error', () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(undefined);
        });
      });
      if (found) break;
    }
    if (!found) throw new Error('Open the Discord desktop app to connect Rich Presence');
    this.socket = found;
    this.clientId = clientId;
    found.on('data', (data) => this.receive(data));
    found.on('error', (error) => this.fail(error));
    found.on('close', () => this.fail(new Error('Discord disconnected')));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error('Discord handshake timed out'));
      }, 5000);
      this.onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.onFailure = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      found!.write(encodeRPC(0, { v: 1, client_id: clientId }));
    });
  }
  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 100000) {
      this.close();
      return;
    }
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 65536) {
        this.close();
        return;
      }
      if (this.buffer.length < length + 8) return;
      const body = this.buffer.subarray(8, length + 8);
      this.buffer = this.buffer.subarray(length + 8);
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(body.toString()) as Record<string, unknown>;
      } catch {
        this.close();
        return;
      }
      if (opcode === 3) this.socket?.write(encodeRPC(4, value));
      if (opcode === 2) {
        this.close();
        return;
      }
      if (opcode !== 1) continue;
      if (value.evt === 'READY') {
        this.onReady?.();
        this.onReady = undefined;
      }
      if (typeof value.nonce === 'string') {
        const pending = this.pending.get(value.nonce);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(value.nonce);
        if (value.evt === 'ERROR')
          pending.reject(new Error('Discord rejected the activity. Check your application ID.'));
        else pending.resolve();
      }
    }
  }
  private fail(error: Error): void {
    this.onFailure?.(error);
    this.onFailure = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.socket = undefined;
  }
  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    this.buffer = Buffer.alloc(0);
    this.fail(new Error('Presence connection closed'));
  }
}
