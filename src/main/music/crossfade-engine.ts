import type {
  AudioGainStatus,
  CrossfadeConfig,
  CrossfadeStatus,
} from '../../shared/types/crossfade';
import type { PlaybackState } from '../../shared/types/music';

export interface FadeDeck {
  read(): Promise<AudioGainStatus>;
  gain(value: number, seconds?: number, curve?: 'in' | 'out'): Promise<void>;
  seek(position: number): Promise<void>;
  play(): Promise<void>;
  close(): void;
}
export interface CrossfadeDependencies {
  state(): PlaybackState;
  primary: Pick<FadeDeck, 'read' | 'gain'>;
  prepare(videoId: string, seconds: number): Promise<FadeDeck>;
  next(): Promise<void>;
  now?(): number;
}

// Owns transition timing independently of Electron or a plugin renderer.
export class CrossfadeEngine {
  private config: CrossfadeConfig = { enabled: false, seconds: 5 };
  private phase: CrossfadeStatus['phase'] = 'off';
  private message?: string;
  private generation = 0;
  private busy = false;
  private deck?: FadeDeck;
  private preparedId?: string;
  private attemptedId?: string;
  private transition?: { outgoingId: string; deadline: number; fadeEnds?: number };
  private now: () => number;
  constructor(private deps: CrossfadeDependencies) {
    this.now = deps.now ?? Date.now;
  }
  status(): CrossfadeStatus {
    return { ...this.config, phase: this.phase, message: this.message };
  }
  configure(config: CrossfadeConfig): CrossfadeStatus {
    this.cancel();
    this.config = { ...config };
    this.attemptedId = undefined;
    this.phase = config.enabled && config.seconds > 0 ? 'waiting' : 'off';
    return this.status();
  }
  cancel(message?: string, retry = false): void {
    const hadAudio = !!this.transition;
    this.generation++;
    this.transition = undefined;
    this.deck?.close();
    this.deck = undefined;
    this.preparedId = undefined;
    if (retry) this.attemptedId = undefined;
    this.message = message;
    this.phase = this.config.enabled && this.config.seconds > 0 ? 'waiting' : 'off';
    if (hadAudio) void this.deps.primary.gain(1).catch(() => {});
  }
  async tick(): Promise<void> {
    if (this.busy || !this.config.enabled || !this.config.seconds) return;
    this.busy = true;
    const generation = this.generation;
    const valid = () => generation === this.generation;
    try {
      const state = this.deps.state();
      const track = state.track;
      const transition = this.transition;
      if (transition && this.deck) {
        if (state.ad || state.repeat === 'one') {
          this.cancel();
          return;
        }
        if (transition.fadeEnds) {
          if (
            (!state.playing && !state.buffering) ||
            track?.videoId === transition.outgoingId ||
            this.now() >= transition.fadeEnds
          )
            this.cancel();
          return;
        }
        const outgoing = await this.deck.read();
        if (!valid()) return;
        if (!outgoing.playing || this.now() > transition.deadline) {
          this.cancel('The next song was not ready in time. Normal playback continues.');
          return;
        }
        const incoming = await this.deps.primary.read();
        if (!valid()) return;
        if (
          track?.videoId &&
          track.videoId !== transition.outgoingId &&
          incoming.playing &&
          incoming.ready
        ) {
          const seconds = Math.min(this.config.seconds, outgoing.duration - outgoing.position);
          if (seconds < 0.2) {
            this.cancel();
            return;
          }
          await this.deps.primary.gain(1, seconds, 'in');
          if (!valid()) return;
          await this.deck.gain(0, seconds, 'out');
          if (!valid()) return;
          transition.fadeEnds = this.now() + seconds * 1000;
        } else {
          // Renew the short fail-open lease while native Next loads the song.
          await this.deps.primary.gain(0);
        }
        return;
      }
      const currentIndex = state.queue.findIndex((item) => item.videoId === track?.videoId);
      const observedNext =
        currentIndex < 0 || state.shuffle || state.repeat === 'all'
          ? state.queue.some((item) => item.videoId && item.videoId !== track?.videoId)
          : state.queue
              .slice(currentIndex + 1)
              .some((item) => item.videoId && item.videoId !== track?.videoId);
      const hasNext = state.nextAvailable ?? observedNext;
      const eligible =
        track?.videoId &&
        (state.playing || state.buffering) &&
        !state.ad &&
        state.repeat !== 'one' &&
        track.duration > this.config.seconds * 2 + 2 &&
        hasNext;
      if (!eligible || !track?.videoId) {
        if (this.deck) this.cancel(undefined, true);
        return;
      }
      const remaining = track.duration - track.position;
      if (this.preparedId && this.preparedId !== track.videoId) this.cancel();
      if (!valid()) return;
      if (
        !this.deck &&
        this.attemptedId !== track.videoId &&
        remaining <= this.config.seconds + 25 &&
        remaining > this.config.seconds + 2
      ) {
        this.attemptedId = track.videoId;
        this.phase = 'preparing';
        this.message = undefined;
        const primary = await this.deps.primary.read();
        if (!valid()) return;
        if (!primary.supported) {
          this.phase = 'waiting';
          this.message = primary.reason;
          return;
        }
        const deck = await this.deps.prepare(track.videoId, this.config.seconds);
        if (!valid()) {
          deck.close();
          return;
        }
        if (this.deps.state().track?.videoId !== track.videoId) {
          deck.close();
          this.cancel();
          return;
        }
        this.deck = deck;
        this.preparedId = track.videoId;
        this.phase = 'ready';
        return;
      }
      if (!this.deck || remaining > this.config.seconds + 0.35 || remaining < 0.3) return;
      const primary = await this.deps.primary.read();
      if (!valid()) return;
      if (!primary.playing || !primary.supported || primary.duration - primary.position < 0.3)
        return;
      await this.deck.seek(primary.position);
      if (!valid()) return;
      await this.deck.play();
      if (!valid()) return;
      const outgoing = await this.deck.read();
      if (!valid()) return;
      if (!outgoing.supported || !outgoing.playing)
        throw new Error('The outgoing song could not be prepared.');
      this.transition = { outgoingId: track.videoId, deadline: this.now() + 8000 };
      this.phase = 'crossfading';
      await this.deps.primary.gain(0);
      if (!valid()) return;
      await this.deck.gain(1);
      if (!valid()) return;
      await this.deps.next();
    } catch (error) {
      if (valid()) this.cancel(`${String(error).slice(0, 140)} Normal playback continues.`);
    } finally {
      this.busy = false;
    }
  }
}
