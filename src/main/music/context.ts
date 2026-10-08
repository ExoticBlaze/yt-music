import { TypedEmitter } from '../../shared/events/emitter';
import { emptyPlayback, type MusicEvents, type PlaybackState } from '../../shared/types/music';

export class MusicContext extends TypedEmitter<MusicEvents> {
  private state = emptyPlayback();
  getState(): PlaybackState {
    return structuredClone(this.state);
  }

  update(next: PlaybackState): void {
    const previous = this.state;
    this.state = next;
    const changedTrack =
      previous.track?.videoId !== next.track?.videoId ||
      previous.track?.title !== next.track?.title ||
      previous.track?.artist !== next.track?.artist ||
      previous.track?.album !== next.track?.album ||
      Math.round(previous.track?.duration ?? 0) !== Math.round(next.track?.duration ?? 0);
    if (changedTrack) this.emit('trackChanged', next.track);
    if (next.playing !== previous.playing)
      this.emit(next.playing ? 'playbackStarted' : 'playbackPaused', next);
    if (previous.track && !next.track) this.emit('playbackStopped', next);
    if (next.track?.position !== previous.track?.position)
      this.emit('positionChanged', next.track?.position ?? 0);
    if (next.volume !== previous.volume || next.muted !== previous.muted)
      this.emit('volumeChanged', { volume: next.volume, muted: next.muted });
    if (JSON.stringify(next.queue) !== JSON.stringify(previous.queue))
      this.emit('queueChanged', next.queue);
    if (next.url !== previous.url) this.emit('navigationChanged', next.url);
    if (next.liked !== previous.liked) this.emit('likeStateChanged', next.liked);
    this.emit('stateChanged', next);
  }
}
