import { z } from 'zod';

export const trackSchema = z.object({
  title: z.string().max(500),
  artist: z.string().max(500),
  artistUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.origin === 'https://music.youtube.com' &&
          !url.username &&
          !url.password &&
          /^\/(channel|browse)\/[\w-]{1,200}\/?$/.test(url.pathname)
        );
      } catch {
        return false;
      }
    }, 'Artist link must be a YouTube Music artist page')
    .optional(),
  album: z.string().max(500).optional(),
  artwork: z.string().max(2048).optional(),
  duration: z.number().finite().min(0).max(86400),
  position: z.number().finite().min(0).max(86400),
  videoId: z
    .string()
    .regex(/^[\w-]{11}$/)
    .optional(),
  playlistId: z
    .string()
    .regex(/^[\w-]{1,200}$/)
    .optional(),
});
export const playbackSchema = z.object({
  track: trackSchema.nullable(),
  playing: z.boolean(),
  buffering: z.boolean().optional(),
  nextAvailable: z.boolean().optional(),
  ad: z.boolean().optional(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  repeat: z.enum(['off', 'one', 'all']),
  shuffle: z.boolean(),
  liked: z.boolean().nullable(),
  queue: z.array(trackSchema).max(500),
  url: z.string().max(2048),
});
export type TrackInfo = z.infer<typeof trackSchema>;
export type PlaybackState = z.infer<typeof playbackSchema>;
export { emptyPlayback } from './playback-state';
export const playerCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum([
      'play',
      'pause',
      'togglePlay',
      'next',
      'previous',
      'toggleMute',
      'toggleShuffle',
      'cycleRepeat',
      'toggleLike',
      'openQueue',
      'openPlayerPage',
      'openUpNext',
      'openArtist',
    ]),
  }),
  z.object({ type: z.enum(['seek', 'setVolume', 'setRate']), value: z.number().finite() }),
  z.object({
    type: z.literal('openTrack'),
    videoId: z.string().regex(/^[\w-]{11}$/),
    playlistId: z
      .string()
      .regex(/^[\w-]{1,200}$/)
      .optional(),
  }),
  z.object({ type: z.literal('playQueueItem'), index: z.number().int().min(0).max(499) }),
]);
export type PlayerCommand = z.infer<typeof playerCommandSchema>;
export interface MusicEvents {
  trackChanged: TrackInfo | null;
  playbackStarted: PlaybackState;
  playbackPaused: PlaybackState;
  playbackStopped: PlaybackState;
  positionChanged: number;
  volumeChanged: { volume: number; muted: boolean };
  queueChanged: TrackInfo[];
  navigationChanged: string;
  likeStateChanged: boolean | null;
  stateChanged: PlaybackState;
}
