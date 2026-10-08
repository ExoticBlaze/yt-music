import type { RoomPlayback } from '../src/shared/types/rooms';

export interface DriftThresholds {
  ignore: number;
  seek: number;
  softRate: number;
}
export type DriftCorrection =
  | { type: 'none'; drift: number }
  | { type: 'rate'; drift: number; rate: number }
  | { type: 'seek'; drift: number; position: number };
export const defaultThresholds: DriftThresholds = { ignore: 0.25, seek: 1, softRate: 0.02 };
export function expectedPosition(
  playback: Pick<RoomPlayback, 'playing' | 'position' | 'timestamp'>,
  serverNow: number,
): number {
  return (
    playback.position + (playback.playing ? Math.max(0, serverNow - playback.timestamp) / 1000 : 0)
  );
}
export function calculateDrift(
  currentPosition: number,
  expected: number,
  playing: boolean,
  thresholds: DriftThresholds = defaultThresholds,
): DriftCorrection {
  if (!Number.isFinite(currentPosition) || !Number.isFinite(expected))
    throw new Error('Playback positions must be finite');
  if (
    thresholds.ignore <= 0 ||
    thresholds.seek <= thresholds.ignore ||
    thresholds.softRate <= 0 ||
    thresholds.softRate > 0.03
  )
    throw new Error('Invalid drift thresholds');
  const drift = expected - currentPosition;
  if (Math.abs(drift) < thresholds.ignore) return { type: 'none', drift };
  if (!playing || Math.abs(drift) > thresholds.seek)
    return { type: 'seek', drift, position: Math.max(0, expected) };
  return { type: 'rate', drift, rate: 1 + Math.sign(drift) * thresholds.softRate };
}
