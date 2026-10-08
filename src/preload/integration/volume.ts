import { webFrame } from 'electron';
import { findMedia } from './detector';
import { selectors } from './selectors';

export interface VolumePreference {
  volume: number;
  muted: boolean;
}

// Native Music sliders use a perceptual volume scale. Let the native control
// map its percentage to audio amplitude instead of overwriting that mapping.
// Only a bounded numeric volume and a mute boolean cross into the page.
function applyPlayerVolume(
  volume: number,
  muted: boolean,
  root: string,
  sliderSelector: string,
  buttonSelector: string,
): boolean {
  const player = document.querySelector(root);
  const slider = player?.querySelector(sliderSelector) as
    (Element & { value: number }) | HTMLInputElement | null;
  if (slider?.tagName === 'TP-YT-PAPER-SLIDER' || slider instanceof HTMLInputElement) {
    if (slider instanceof HTMLInputElement) {
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 100);
      slider.value = String(min + volume * (max - min));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    } else slider.value = Math.round(volume * 100);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const media =
      document.querySelector<HTMLMediaElement>('ytmusic-player video, ytmusic-player audio') ??
      document.querySelector<HTMLMediaElement>('video, audio');
    if (media && media.muted !== muted)
      player?.querySelector<HTMLButtonElement>(buttonSelector)?.click();
    return true;
  }
  const api = document.querySelector('#movie_player') as
    | (Element & {
        setVolume?(value: number): void;
        mute?(): void;
        unMute?(): void;
      })
    | null;
  api?.setVolume?.(volume * 100);
  if (muted) api?.mute?.();
  else api?.unMute?.();
  return false;
}

export class VolumeController {
  private preference?: VolumePreference;
  private media: HTMLMediaElement | null = null;
  private appliedVolume?: number;
  private applying = false;
  private retry = false;
  private nativeInputUntil = 0;
  private indicator: HTMLSpanElement | null = null;
  constructor(private save: (preference: VolumePreference) => void) {
    for (const event of ['loadstart', 'loadedmetadata', 'playing', 'volumechange'])
      document.addEventListener(event, this.changed, true);
    for (const event of ['pointerdown', 'pointermove', 'click', 'keydown', 'input', 'change'])
      document.addEventListener(event, this.nativeInput, true);
    document.addEventListener('wheel', this.wheel, { capture: true, passive: false });
  }
  receive(preference: VolumePreference): void {
    if (
      !Number.isFinite(preference.volume) ||
      preference.volume < 0 ||
      preference.volume > 1 ||
      typeof preference.muted !== 'boolean'
    )
      return;
    this.preference = { ...preference };
    void this.apply();
  }
  async command(
    command: { type: 'setVolume'; value: number } | { type: 'toggleMute' },
  ): Promise<void> {
    const current = this.preference ?? {
      volume: findMedia()?.volume ?? 1,
      muted: findMedia()?.muted ?? false,
    };
    this.preference =
      command.type === 'setVolume'
        ? { volume: Math.max(0, Math.min(1, command.value)), muted: false }
        : { ...current, muted: !current.muted };
    this.save({ ...this.preference });
    await this.apply();
  }
  discover(): void {
    const media = findMedia();
    const changed = media !== this.media;
    this.media = media;
    if (changed) this.appliedVolume = undefined;
    if (changed || this.mismatch()) void this.apply();
    this.renderPercent();
  }
  private mismatch(): boolean {
    return (
      !!this.media &&
      !!this.preference &&
      (Math.abs(this.currentVolume() - this.preference.volume) > 0.001 ||
        (this.appliedVolume !== undefined &&
          Math.abs(this.media.volume - this.appliedVolume) > 0.001) ||
        this.media.muted !== this.preference.muted)
    );
  }
  private currentVolume(): number {
    const slider = document.querySelector(selectors.player)?.querySelector(selectors.volumeSlider);
    if (slider instanceof HTMLInputElement) {
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 100);
      const value = Number(slider.value);
      if (Number.isFinite(value) && max > min)
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }
    const value = Number(slider?.getAttribute('value'));
    return slider?.tagName === 'TP-YT-PAPER-SLIDER' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
      ? value / 100
      : (this.media?.volume ?? 1);
  }
  private renderPercent(): void {
    const speaker = document.querySelector(selectors.player)?.querySelector(selectors.volumeAnchor);
    if (!speaker) {
      this.indicator?.remove();
      this.indicator = null;
      return;
    }
    if (!this.indicator?.isConnected || this.indicator.parentElement !== speaker.parentElement) {
      this.indicator?.remove();
      this.indicator = document.createElement('span');
      this.indicator.id = 'ytmusic-plus-volume-percent';
      speaker.before(this.indicator);
    }
    const percent = Math.round(this.currentVolume() * 100);
    const muted = this.media?.muted ?? this.preference?.muted ?? false;
    const text = `${muted ? 0 : percent}%`;
    const title = `${muted ? `Muted (saved volume ${percent}%)` : `Volume ${percent}%`} · Scroll over the player bar to change volume`;
    if (this.indicator.textContent !== text) this.indicator.textContent = text;
    if (this.indicator.title !== title) this.indicator.title = title;
    const label = muted ? `Muted, volume ${percent}%` : `Volume ${percent}%`;
    if (this.indicator.getAttribute('aria-label') !== label)
      this.indicator.setAttribute('aria-label', label);
  }
  private changed = (event: Event) => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    this.media = findMedia();
    if (event.type === 'loadstart' || event.type === 'loadedmetadata') this.nativeInputUntil = 0;
    // Native slider/mute actions become the saved preference. Automatic per-song
    // resets still restore the preference instead of overwriting it.
    if (
      event.type === 'volumechange' &&
      event.target === this.media &&
      !this.applying &&
      performance.now() < this.nativeInputUntil &&
      this.mismatch()
    ) {
      this.preference = { volume: this.currentVolume(), muted: this.media.muted };
      this.appliedVolume = this.media.volume;
      this.save({ ...this.preference });
      this.renderPercent();
      return;
    }
    if (event.type !== 'volumechange' || this.mismatch()) void this.apply();
    this.renderPercent();
  };
  private volumeTarget(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (target) =>
          target instanceof Element &&
          !!target.closest(selectors.player) &&
          (target.matches(
            `${selectors.volumeSlider}, #volume-slider-expanded, .volume-slider, ${selectors.volumeAnchor}`,
          ) ||
            /^(unmute|mute|volume)(\b|$)/i.test(
              target.getAttribute('aria-label') || target.getAttribute('title') || '',
            )),
      );
  }
  private nativeInput = (event: Event): void => {
    if (this.applying) return;
    const target = event.target instanceof Element ? event.target : null;
    const playerShortcut =
      event instanceof KeyboardEvent &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !target?.closest('input, textarea, [contenteditable="true"]') &&
      (event.key.toLowerCase() === 'm' ||
        (['ArrowUp', 'ArrowDown'].includes(event.key) &&
          !!target?.closest(`${selectors.player}, ytmusic-player`)));
    if (this.volumeTarget(event) || playerShortcut)
      this.nativeInputUntil = performance.now() + 2000;
    else if (event.type === 'pointerdown' || event.type === 'click') this.nativeInputUntil = 0;
  };
  private wheel = (event: WheelEvent): void => {
    if (
      !event.deltaY ||
      event.ctrlKey ||
      !event
        .composedPath()
        .some((target) => target instanceof Element && !!target.closest(selectors.player))
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.nativeInputUntil = 0;
    const volume = this.preference?.volume ?? this.currentVolume();
    void this.command({ type: 'setVolume', value: volume + (event.deltaY < 0 ? 0.02 : -0.02) });
  };
  private async apply(): Promise<void> {
    if (!this.preference) return;
    if (this.applying) {
      this.retry = true;
      return;
    }
    this.applying = true;
    const { volume, muted } = this.preference;
    try {
      const native: boolean = await webFrame.executeJavaScript(
        `(${applyPlayerVolume.toString()})(${volume},${muted},${JSON.stringify(selectors.player)},${JSON.stringify(selectors.volumeSlider)},${JSON.stringify(selectors.volumeButton)})`,
      );
      const media = findMedia();
      this.media = media;
      if (media && !native) {
        if (Math.abs(media.volume - volume) > 0.001) media.volume = volume;
        if (media.muted !== muted) media.muted = muted;
      }
      this.appliedVolume = media?.volume;
    } catch (error) {
      console.error('YTMusic+ volume:', String(error));
    } finally {
      this.applying = false;
      this.renderPercent();
      if (this.retry) {
        this.retry = false;
        void this.apply();
      }
    }
  }
  dispose(): void {
    this.indicator?.remove();
    this.indicator = null;
    for (const event of ['loadstart', 'loadedmetadata', 'playing', 'volumechange'])
      document.removeEventListener(event, this.changed, true);
    for (const event of ['pointerdown', 'pointermove', 'click', 'keydown', 'input', 'change'])
      document.removeEventListener(event, this.nativeInput, true);
    document.removeEventListener('wheel', this.wheel, true);
  }
}
