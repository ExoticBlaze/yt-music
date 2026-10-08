import type { Participant, RoomSnapshot } from './rooms';

export function emptyRoom(): RoomSnapshot {
  return {
    connection: 'Disconnected',
    code: null,
    selfId: null,
    participants: [],
    permissions: { djPlayback: true, djSeek: true, djQueue: false },
    playback: null,
    serverTime: Date.now(),
    clockOffset: 0,
  };
}
export function canControl(
  role: Participant['role'],
  action: 'playback' | 'seek' | 'queue' | 'manage',
  permissions: RoomSnapshot['permissions'],
): boolean {
  if (role === 'host') return true;
  if (role !== 'dj') return false;
  return action === 'playback'
    ? permissions.djPlayback
    : action === 'seek'
      ? permissions.djSeek
      : action === 'queue'
        ? permissions.djQueue
        : false;
}
