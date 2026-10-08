import { expect, it } from 'vitest';
import { encodeRPC } from '../src/main/presence/discord-rpc';

it('serializes Discord IPC frames using UTF-8 byte lengths', () => {
  const value = { cmd: 'SET_ACTIVITY', args: { activity: { details: 'Music ♪' } } };
  const frame = encodeRPC(1, value);
  expect(frame.readInt32LE(0)).toBe(1);
  expect(frame.readInt32LE(4)).toBe(frame.length - 8);
  expect(JSON.parse(frame.subarray(8).toString('utf8'))).toEqual(value);
});
