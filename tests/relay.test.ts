import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { once } from 'node:events';
import { createRelay } from '../server/relay';
import { roomServerMessageSchema, type RoomServerMessage } from '../src/shared/types/rooms';
import { validateRelayURL } from '../client/websocket-transport';

async function waitMessage(
  socket: WebSocket,
  test: (message: RoomServerMessage) => boolean,
): Promise<RoomServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', receive);
      reject(new Error('Message timeout'));
    }, 3000);
    const receive = (data: WebSocket.RawData) => {
      const message = roomServerMessageSchema.parse(JSON.parse(data.toString()));
      if (test(message)) {
        clearTimeout(timer);
        socket.off('message', receive);
        resolve(message);
      }
    };
    socket.on('message', receive);
  });
}
describe('WebSocket relay', () => {
  it('creates a room, rejects listener controls, promotes a DJ, and resumes identity', async () => {
    const relay = createRelay({ port: 0 });
    await once(relay.server, 'listening');
    const address = relay.server.address();
    if (!address || typeof address === 'string') throw new Error('No relay port');
    const url = `ws://127.0.0.1:${address.port}`;
    const host = new WebSocket(url);
    const listener = new WebSocket(url);
    let resumed: WebSocket | undefined;
    try {
      await Promise.all([once(host, 'open'), once(listener, 'open')]);
      const welcome = waitMessage(host, (message) => message.type === 'welcome');
      host.send(JSON.stringify({ type: 'create', name: 'Host' }));
      const hostWelcome = await welcome;
      if (hostWelcome.type !== 'welcome') throw new Error('Missing welcome');
      const joined = waitMessage(listener, (message) => message.type === 'welcome');
      listener.send(
        JSON.stringify({ type: 'join', code: hostWelcome.snapshot.code, name: 'Listener' }),
      );
      const listenerWelcome = await joined;
      if (listenerWelcome.type !== 'welcome') throw new Error('Missing welcome');
      const denied = waitMessage(listener, (message) => message.type === 'error');
      listener.send(JSON.stringify({ type: 'seek', position: 20, timestamp: Date.now() }));
      expect((await denied).type).toBe('error');
      const promoted = waitMessage(
        listener,
        (message) =>
          message.type === 'snapshot' &&
          message.snapshot.participants.some(
            (value) => value.id === listenerWelcome.snapshot.selfId && value.role === 'dj',
          ),
      );
      host.send(
        JSON.stringify({
          type: 'promote',
          participantId: listenerWelcome.snapshot.selfId,
          role: 'dj',
        }),
      );
      await promoted;
      const seek = waitMessage(
        host,
        (message) => message.type === 'snapshot' && message.snapshot.playback?.position === 20,
      );
      listener.send(JSON.stringify({ type: 'seek', position: 20, timestamp: Date.now() }));
      await seek;
      listener.terminate();
      await once(listener, 'close');
      resumed = new WebSocket(url);
      await once(resumed, 'open');
      const reconnect = waitMessage(resumed, (message) => message.type === 'welcome');
      resumed.send(
        JSON.stringify({
          type: 'join',
          code: hostWelcome.snapshot.code,
          name: 'Listener',
          resumeToken: listenerWelcome.resumeToken,
        }),
      );
      const rejoined = await reconnect;
      if (rejoined.type !== 'welcome') throw new Error('Missing welcome');
      expect(rejoined.snapshot.selfId).toBe(listenerWelcome.snapshot.selfId);
      expect(
        rejoined.snapshot.participants.find((value) => value.id === rejoined.snapshot.selfId)?.role,
      ).toBe('dj');
    } finally {
      host.terminate();
      listener.terminate();
      resumed?.terminate();
      await relay.close();
    }
  });
  it('requires TLS for remote relays', () => {
    expect(validateRelayURL('ws://127.0.0.1:8787')).toContain('127.0.0.1');
    expect(() => validateRelayURL('ws://example.com')).toThrow('TLS');
    expect(() => validateRelayURL('https://example.com')).toThrow();
  });
});
