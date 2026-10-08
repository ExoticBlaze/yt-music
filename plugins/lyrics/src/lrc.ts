import type { LyricLine } from '../../../plugin-sdk/index';

export function parseLRC(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  for (const raw of source.split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of timestamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      if (seconds >= 60) continue;
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0;
      lines.push({ time: Math.max(0, minutes * 60 + seconds + fraction - offset), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 2000);
}
