import { describe, expect, it, vi } from 'vitest';
import { CrossfadeEngine, type FadeDeck } from '../src/main/music/crossfade-engine';
import { emptyPlayback, type PlaybackState } from '../src/shared/types/music';
import { fadeCurve } from '../src/shared/audio/fade-curve';
import { crossfadeConfigSchema, type AudioGainStatus } from '../src/shared/types/crossfade';
import { pluginCallSchema } from '../src/shared/types/plugin-rpc';

function harness() {
  const state: PlaybackState = {
    ...emptyPlayback(),
    playing: true,
    volume: 0.37,
    track: { videoId: 'abcdefghijk', title: 'First', artist: 'Artist', duration: 40, position: 15 },
    queue: [
      { videoId: 'abcdefghijk', title: 'First', artist: 'Artist', duration: 40, position: 0 },
      { videoId: 'zyxwvutsrqp', title: 'Second', artist: 'Artist', duration: 40, position: 0 },
    ],
  };
  const audio: AudioGainStatus = {
    supported: true,
    ready: true,
    playing: false,
    gain: 0,
    position: 0,
    duration: 40,
  };
  const deck: FadeDeck = {
    read: vi.fn(async () => ({ ...audio })),
    gain: vi.fn(async () => {}),
    seek: vi.fn(async (position) => {
      audio.position = position;
    }),
    play: vi.fn(async () => {
      audio.playing = true;
    }),
    close: vi.fn(() => {
      audio.playing = false;
    }),
  };
  const primary = {
    read: vi.fn(async () => ({
      ...audio,
      playing: state.playing,
      position: state.track!.position,
      gain: 1,
    })),
    gain: vi.fn(async (_gain: number, _seconds?: number, _curve?: 'in' | 'out') => {}),
  };
  const prepare = vi.fn(async () => deck);
  const next = vi.fn(async () => {
    state.track = { ...state.queue[1]!, position: 0 };
  });
  let time = 0;
  const engine = new CrossfadeEngine({
    state: () => state,
    primary,
    prepare,
    next,
    now: () => time,
  });
  engine.configure({ enabled: true, seconds: 5 });
  return {
    engine,
    state,
    audio,
    deck,
    primary,
    prepare,
    next,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('crossfade transitions', () => {
  it('overlaps the outgoing tail with the incoming head, then closes the companion without changing saved volume', async () => {
    const h = harness();
    await h.engine.tick();
    expect(h.engine.status().phase).toBe('ready');
    h.state.track!.position = 35;
    await h.engine.tick();
    expect(h.deck.seek).toHaveBeenCalledWith(35);
    expect(h.next).toHaveBeenCalledOnce();
    expect(h.audio.playing && h.state.playing).toBe(true);
    await h.engine.tick();
    expect(h.primary.gain).toHaveBeenLastCalledWith(1, 5, 'in');
    expect(h.deck.gain).toHaveBeenLastCalledWith(0, 5, 'out');
    h.advance(5001);
    await h.engine.tick();
    expect(h.deck.close).toHaveBeenCalledOnce();
    expect(h.primary.gain).toHaveBeenLastCalledWith(1);
    expect(h.state.volume).toBe(0.37);
  });
  it.each(['paused', 'ad', 'repeat-one', 'live', 'short', 'last-track'])(
    'keeps normal playback for %s',
    async (kind) => {
      const h = harness();
      if (kind === 'paused') h.state.playing = false;
      if (kind === 'ad') h.state.ad = true;
      if (kind === 'repeat-one') h.state.repeat = 'one';
      if (kind === 'live') h.state.track!.duration = 0;
      if (kind === 'short') h.state.track!.duration = 8;
      if (kind === 'last-track') h.state.queue.reverse();
      await h.engine.tick();
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.next).not.toHaveBeenCalled();
    },
  );
  it('never mutes or advances a player that cannot provide Web Audio', async () => {
    const h = harness();
    h.primary.read.mockResolvedValue({ ...h.audio, supported: false, reason: 'Unavailable' });
    await h.engine.tick();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.primary.gain).not.toHaveBeenCalled();
    expect(h.engine.status().message).toBe('Unavailable');
  });
  it('prepares from native Next availability when queue metadata is absent', async () => {
    const h = harness();
    h.state.queue = [];
    h.state.nextAvailable = true;
    await h.engine.tick();
    expect(h.engine.status().phase).toBe('ready');
  });
  it('retains the prepared player during buffering but still cancels a pause', async () => {
    const h = harness();
    await h.engine.tick();
    h.state.playing = false;
    h.state.buffering = true;
    await h.engine.tick();
    expect(h.deck.close).not.toHaveBeenCalled();
    h.state.buffering = false;
    await h.engine.tick();
    expect(h.deck.close).toHaveBeenCalledOnce();
  });
  it('can prepare again after the user pauses and resumes the same song', async () => {
    const h = harness();
    await h.engine.tick();
    h.state.playing = false;
    await h.engine.tick();
    h.state.playing = true;
    await h.engine.tick();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(h.engine.status().phase).toBe('ready');
  });
  it('restores audio and destroys the outgoing player if native Next fails', async () => {
    const h = harness();
    await h.engine.tick();
    h.next.mockRejectedValue(new Error('Unavailable'));
    h.state.track!.position = 35;
    await h.engine.tick();
    expect(h.primary.gain).toHaveBeenLastCalledWith(1);
    expect(h.deck.close).toHaveBeenCalledOnce();
    expect(h.engine.status().phase).toBe('waiting');
  });
  it('fails open when the incoming song does not load', async () => {
    const h = harness();
    await h.engine.tick();
    h.next.mockImplementation(async () => {});
    h.state.track!.position = 35;
    await h.engine.tick();
    h.advance(8001);
    await h.engine.tick();
    expect(h.primary.gain).toHaveBeenLastCalledWith(1);
    expect(h.deck.close).toHaveBeenCalledOnce();
  });
  it('cancels an active fade immediately when disabled or paused', async () => {
    for (const disable of [true, false]) {
      const h = harness();
      await h.engine.tick();
      h.state.track!.position = 35;
      await h.engine.tick();
      await h.engine.tick();
      if (disable) h.engine.configure({ enabled: false, seconds: 5 });
      else {
        h.state.playing = false;
        await h.engine.tick();
      }
      expect(h.deck.close).toHaveBeenCalledOnce();
      expect(h.primary.gain).toHaveBeenLastCalledWith(1);
    }
  });
  it('discards a preparation that finishes after cancellation', async () => {
    const h = harness();
    let finish!: (deck: FadeDeck) => void;
    h.prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = h.engine.tick();
    await vi.waitFor(() => expect(h.prepare).toHaveBeenCalledOnce());
    h.engine.configure({ enabled: false, seconds: 5 });
    finish(h.deck);
    await pending;
    expect(h.deck.close).toHaveBeenCalledOnce();
    expect(h.next).not.toHaveBeenCalled();
    expect(h.engine.status().phase).toBe('off');
  });
  it('accepts bounded plugin settings and rejects invalid fade commands', () => {
    for (const seconds of [0, 5, 12])
      expect(crossfadeConfigSchema.safeParse({ enabled: true, seconds }).success).toBe(true);
    for (const seconds of [-1, 13, Infinity, NaN, 2.5, '5'])
      expect(
        pluginCallSchema.safeParse({
          type: 'crossfade.configure',
          value: { enabled: true, seconds },
        }).success,
      ).toBe(false);
  });
  it('uses complementary equal-power gain curves with exact endpoints', () => {
    const incoming = fadeCurve(0, 1, 'in');
    const outgoing = fadeCurve(1, 0, 'out');
    expect([incoming[0], incoming.at(-1), outgoing[0], outgoing.at(-1)]).toEqual([0, 1, 1, 0]);
    for (let index = 0; index < incoming.length; index++)
      expect(incoming[index]! ** 2 + outgoing[index]! ** 2).toBeCloseTo(1, 6);
  });
});
