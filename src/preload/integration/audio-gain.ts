import { findMedia } from './detector';
import { fadeCurve } from '../../shared/audio/fade-curve';
import type { AudioGainRequest, AudioGainStatus } from '../../shared/types/crossfade';

interface Graph {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

export class AudioGainController {
  private context?: AudioContext;
  private graphs = new Map<HTMLMediaElement, Graph>();
  private known = new WeakMap<HTMLMediaElement, Graph>();
  private target = 1;
  private secondary = false;
  private lease?: ReturnType<typeof setTimeout>;
  private fadeUntil = 0;
  constructor(private ended: () => void) {
    document.addEventListener('ended', this.onEnded, true);
  }
  private onEnded = (event: Event): void => {
    if (!this.secondary || !(event.target instanceof HTMLMediaElement)) return;
    // The outgoing deck must never start playing another queued song.
    event.stopImmediatePropagation();
    this.reset(0);
    event.target.pause();
    this.ended();
  };
  private eligible(media: HTMLMediaElement): boolean {
    if (media.mediaKeys || !media.currentSrc) return false;
    try {
      const url = new URL(media.currentSrc, location.href);
      return (
        url.protocol === 'blob:' ||
        url.protocol === 'data:' ||
        url.origin === location.origin ||
        !!media.crossOrigin
      );
    } catch {
      return false;
    }
  }
  private async attach(media: HTMLMediaElement): Promise<Graph | undefined> {
    const existing = this.graphs.get(media);
    if (existing) return existing;
    const previous = this.known.get(media);
    if (previous && this.context) {
      previous.gain.gain.value = this.target;
      previous.source.connect(previous.gain);
      previous.gain.connect(this.context.destination);
      this.graphs.set(media, previous);
      return previous;
    }
    if (!this.eligible(media)) return;
    const context = (this.context ??= new AudioContext());
    if (context.state !== 'running') {
      await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 1200))]);
      if ((context.state as AudioContextState) !== 'running') return;
    }
    // Resume before redirecting native output; a suspended context must never
    // turn working playback into silence. Sources stay connected at unity on
    // disable because the browser permits only one source node per element.
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    gain.gain.value = this.target;
    source.connect(gain);
    gain.connect(context.destination);
    const graph = { source, gain };
    this.graphs.set(media, graph);
    this.known.set(media, graph);
    return graph;
  }
  async command(request: AudioGainRequest): Promise<AudioGainStatus> {
    if (request.secondary !== undefined) this.secondary = request.secondary;
    const media = findMedia();
    let graph: Graph | undefined;
    let reason: string | undefined;
    if (media) {
      try {
        graph = await this.attach(media);
      } catch {
        reason = 'This player cannot provide an audio fade. Normal playback continues.';
      }
    }
    if (request.gain !== undefined) {
      this.target = request.gain;
      this.fadeUntil = performance.now() + (request.seconds ?? 0) * 1000;
      const context = this.context;
      if (graph && context) {
        const parameter = graph.gain.gain;
        const time = context.currentTime;
        parameter.cancelAndHoldAtTime(time);
        if (request.seconds)
          parameter.setValueCurveAtTime(
            fadeCurve(parameter.value, request.gain, request.curve ?? 'in'),
            time,
            request.seconds,
          );
        else parameter.setValueAtTime(request.gain, time);
      }
      clearTimeout(this.lease);
      // Fail open after a renderer/main-process interruption. The companion
      // stays silent; the visible native player always returns to full gain.
      if (request.gain < 1 || request.seconds)
        this.lease = setTimeout(
          () => this.reset(this.secondary ? 0 : 1),
          ((request.seconds ?? 0) + 3) * 1000,
        );
    }
    for (const [element, previous] of this.graphs) {
      if (!element.isConnected) {
        previous.source.disconnect();
        previous.gain.disconnect();
        this.graphs.delete(element);
      }
    }
    return {
      supported: !!graph,
      ready: !!media && media.readyState >= 2 && !media.seeking,
      playing: !!media && !media.paused && !media.ended,
      gain: Math.max(0, Math.min(1, graph?.gain.gain.value ?? 1)),
      position: Number.isFinite(media?.currentTime)
        ? Math.max(0, Math.min(86400, media!.currentTime))
        : 0,
      duration: Number.isFinite(media?.duration)
        ? Math.max(0, Math.min(86400, media!.duration))
        : 0,
      reason: graph ? undefined : (reason ?? 'Waiting for audio that supports crossfade.'),
    };
  }
  reset(value = 1): void {
    clearTimeout(this.lease);
    this.target = value;
    this.fadeUntil = 0;
    for (const graph of this.graphs.values()) {
      graph.gain.gain.cancelScheduledValues(0);
      graph.gain.gain.value = value;
    }
  }
  get fading(): boolean {
    return this.target < 1 || performance.now() < this.fadeUntil;
  }
  dispose(): void {
    this.reset();
    document.removeEventListener('ended', this.onEnded, true);
  }
}
