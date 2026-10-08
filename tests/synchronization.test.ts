import { describe, expect, it } from 'vitest';
import { expectedPosition, calculateDrift } from '../client/synchronization';
import {
  canControl,
  roomClientMessageSchema,
  roomServerMessageSchema,
  emptyRoom,
} from '../src/shared/types/rooms';

describe('room synchronization', () => {
  it('interpolates using server time only while playing', () => {
    expect(expectedPosition({ playing: true, position: 42, timestamp: 1000 }, 3500)).toBe(44.5);
    expect(expectedPosition({ playing: false, position: 42, timestamp: 1000 }, 3500)).toBe(42);
    expect(expectedPosition({ playing: true, position: 42, timestamp: 4000 }, 3500)).toBe(42);
  });
  it('ignores small drift, corrects moderate drift gradually, and seeks large drift', () => {
    expect(calculateDrift(10, 10.1, true).type).toBe('none');
    expect(calculateDrift(10, 10.6, true)).toMatchObject({ type: 'rate', rate: 1.02 });
    expect(calculateDrift(10, 9.4, true)).toMatchObject({ type: 'rate', rate: 0.98 });
    expect(calculateDrift(10, 12, true)).toMatchObject({ type: 'seek', position: 12 });
    expect(calculateDrift(10, 10.6, false).type).toBe('seek');
  });
  it('rejects invalid numbers and overlapping thresholds', () => {
    expect(() => calculateDrift(NaN, 10, true)).toThrow();
    expect(() => calculateDrift(10, 11, true, { ignore: 1, seek: 0.5, softRate: 0.02 })).toThrow();
  });
});
describe('room protocol and permissions', () => {
  it('checks host, DJ and listener capabilities', () => {
    const permissions = emptyRoom().permissions;
    expect(canControl('host', 'manage', permissions)).toBe(true);
    expect(canControl('listener', 'playback', permissions)).toBe(false);
    expect(canControl('dj', 'playback', permissions)).toBe(true);
    expect(canControl('dj', 'queue', permissions)).toBe(false);
    expect(canControl('dj', 'manage', { ...permissions, djQueue: true })).toBe(false);
  });
  it('validates messages and round-trips snapshots', () => {
    expect(
      roomClientMessageSchema.safeParse({ type: 'seek', position: -2, timestamp: 1 }).success,
    ).toBe(false);
    expect(
      roomClientMessageSchema.safeParse({ type: 'track-change', trackId: 'bad', timestamp: 1 })
        .success,
    ).toBe(false);
    expect(roomClientMessageSchema.safeParse({ type: 'execute', code: 'anything' }).success).toBe(
      false,
    );
    const message = { type: 'snapshot', snapshot: emptyRoom() };
    expect(roomServerMessageSchema.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });
});
