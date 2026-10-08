import type { PlaybackState } from './music';

export function emptyPlayback(): PlaybackState {
  return {
    track: null,
    playing: false,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    liked: null,
    queue: [],
    url: 'https://music.youtube.com',
  };
}
