import { describe, expect, it } from 'vitest';
import { TypedEmitter } from '../src/shared/events/emitter';
import { MusicContext } from '../src/main/music/context';
import { emptyPlayback } from '../src/shared/types/music';

describe('typed events', () => {
  it('unsubscribes safely and isolates callback exceptions', () => {
    const errors: unknown[] = [];
    const events = new TypedEmitter<{ value: number }>((error) => errors.push(error));
    const received: number[] = [];
    events.on('value', () => {
      throw new Error('Broken subscriber');
    });
    const off = events.on('value', (value) => received.push(value));
    events.emit('value', 1);
    off();
    off();
    events.emit('value', 2);
    expect(received).toEqual([1]);
    expect(errors).toHaveLength(2);
    events.clear();
    events.emit('value', 3);
    expect(errors).toHaveLength(2);
  });
  it('publishes track/playback/seek changes without repeating track events', () => {
    const context = new MusicContext();
    const events: string[] = [];
    context.on('trackChanged', () => events.push('track'));
    context.on('playbackStarted', () => events.push('play'));
    context.on('playbackPaused', () => events.push('pause'));
    const state = {
      ...emptyPlayback(),
      playing: true,
      track: {
        title: 'Song',
        artist: 'Artist',
        videoId: 'abcdefghijk',
        duration: 100,
        position: 0,
      },
    };
    context.update(state);
    context.update({ ...state, track: { ...state.track, position: 1 } });
    context.update({ ...state, playing: false });
    expect(events).toEqual(['track', 'play', 'pause']);
    const copy = context.getState();
    copy.track!.title = 'Changed';
    expect(context.getState().track?.title).toBe('Song');
  });
});
