import { ipcRenderer, webFrame } from 'electron';
import { IPC } from '../../shared/constants/ipc';
import { prunePlayerAds, canFinishPlaybackAd } from '../../shared/blocking/player-response';

// Serialized into the page world. All dependencies are fixed first-party
// functions; this handle contains no IPC, credentials or Electron objects.
function installPlayerAdBlocking(
  prune: typeof prunePlayerAds,
  canFinish: typeof canFinishPlaybackAd,
  initial: boolean,
): void {
  interface Handle {
    configure(enabled: boolean): void;
    stats(): { filteredResponses: number; skippedAds: number };
  }
  const key = Symbol.for('ytmusic-plus.playback-ad-blocker');
  const page = window as unknown as Record<symbol, Handle | undefined> & Record<string, unknown>;
  if (page[key]) {
    page[key]!.configure(initial);
    return;
  }
  const originalParse = JSON.parse;
  const originalJson = Response.prototype.json;
  const responseDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  let enabled = false;
  let filteredResponses = 0;
  let skippedAds = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let queued: ReturnType<typeof setTimeout> | undefined;
  let player: Element | null = null;
  let cooldown = 0;
  const globals = new Map<
    string,
    { descriptor?: PropertyDescriptor; get: () => unknown; set: (value: unknown) => void }
  >();
  const configs = new Map<
    Record<string, unknown>,
    { original: (...args: unknown[]) => unknown; wrapper: (...args: unknown[]) => unknown }
  >();
  const clean = <T>(input: T): T => {
    if (!enabled) return input;
    try {
      const result = prune(input, originalParse);
      if (result.removed) filteredResponses++;
      return result.value;
    } catch {
      return input;
    } // Preserve unusual site-owned objects and revivers.
  };
  const parseProxy = new Proxy(originalParse, {
    apply: (target, receiver, args) => clean(Reflect.apply(target, receiver, args)),
  });
  const jsonProxy = new Proxy(originalJson, {
    apply: (target, receiver, args) =>
      (Reflect.apply(target, receiver, args) as Promise<unknown>).then(clean),
  });
  const responseProxy =
    responseDescriptor?.get &&
    new Proxy(responseDescriptor.get, {
      apply: (target, receiver, args) => {
        const value = Reflect.apply(target, receiver, args);
        return (receiver as XMLHttpRequest).responseType === 'json' ? clean(value) : value;
      },
    });
  const patchConfig = (input: unknown): unknown => {
    if (!input || typeof input !== 'object') return input;
    const config = input as Record<string, unknown>;
    if (typeof config.set === 'function' && !configs.has(config)) {
      const original = config.set as (...args: unknown[]) => unknown;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        if (typeof args[0] === 'object') clean(args[0]);
        else if (args[0] === 'PLAYER_VARS') clean(args[1]);
        return Reflect.apply(original, this, args);
      };
      try {
        config.set = wrapper;
        configs.set(config, { original, wrapper });
      } catch {
        /* A frozen config still uses JSON response filtering. */
      }
    }
    if (config.data_ && typeof config.data_ === 'object') clean(config.data_);
    return input;
  };
  const hookGlobal = (name: string, transform: (value: unknown) => unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) {
      transform(page[name]);
      return;
    }
    let current = transform(descriptor?.value);
    const get = () => current;
    const set = (input: unknown) => {
      current = enabled ? transform(input) : input;
    };
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get,
        set,
      });
      globals.set(name, { descriptor, get, set });
    } catch {
      /* Preserve site-owned nonconfigurable globals. */
    }
  };
  const schedule = () => {
    if (!enabled || queued) return;
    queued = setTimeout(() => {
      queued = undefined;
      discover();
    }, 50);
  };
  const observer = new MutationObserver(schedule);
  const discover = () => {
    if (!enabled) return;
    const next = document.querySelector('#movie_player');
    if (player !== next) {
      observer.disconnect();
      player = next;
      if (player)
        observer.observe(player, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'disabled', 'aria-disabled'],
        });
    }
    if (
      !player?.classList.contains('ad-showing') &&
      !player?.classList.contains('ad-interrupting')
    ) {
      cooldown = 0;
      return;
    }
    if (Date.now() < cooldown) return;
    const media =
      player.querySelector<HTMLMediaElement>('video,audio') ??
      document.querySelector<HTMLMediaElement>('ytmusic-player video,ytmusic-player audio');
    if (!media || media.paused) return;
    const skip = player.querySelector<HTMLElement>(
      '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button',
    );
    if (
      skip &&
      !skip.matches(':disabled,[disabled],[aria-disabled="true"]') &&
      skip.getClientRects().length > 0
    ) {
      cooldown = Date.now() + 1000;
      skip.click();
      skippedAds++;
      return;
    }
    const selected = document.querySelector(
      'ytmusic-player-queue-item[selected], ytmusic-player-queue-item[is-selected]',
    ) as (Element & { data?: { lengthText?: { runs?: { text?: string }[] } } }) | null;
    const parts = selected?.data?.lengthText?.runs?.[0]?.text?.split(':').map(Number);
    const contentDuration = parts?.every(Number.isFinite)
      ? parts.reduce((sum, part) => sum * 60 + part, 0)
      : undefined;
    if (
      !canFinish({
        showing: true,
        paused: media.paused,
        duration: media.duration,
        position: media.currentTime,
        contentDuration,
      })
    )
      return;
    try {
      // Finish only the positively identified advertisement. Native ended
      // handling starts the original song; never click Next or change volume,
      // mute or playback rate, which would affect songs or saved preferences.
      cooldown = Date.now() + 1000;
      media.currentTime = media.duration;
      skippedAds++;
    } catch {
      /* Unseekable ads remain with the native player. */
    }
  };
  const handle: Handle = {
    configure(next) {
      if (enabled === next) return;
      enabled = next;
      if (enabled) {
        JSON.parse = parseProxy;
        Response.prototype.json = jsonProxy;
        if (responseDescriptor?.configurable && responseProxy)
          Object.defineProperty(XMLHttpRequest.prototype, 'response', {
            ...responseDescriptor,
            get: responseProxy,
          });
        hookGlobal('ytInitialPlayerResponse', clean);
        hookGlobal('ytcfg', patchConfig);
        clean(page.ytInitialPlayerResponse);
        patchConfig(page.ytcfg);
        timer = setInterval(discover, 1000);
        document.addEventListener('playing', schedule, true);
        document.addEventListener('loadedmetadata', schedule, true);
        document.addEventListener('durationchange', schedule, true);
        document.addEventListener('DOMContentLoaded', schedule);
        discover();
      } else {
        if (JSON.parse === parseProxy) JSON.parse = originalParse;
        if (Response.prototype.json === jsonProxy) Response.prototype.json = originalJson;
        if (
          responseDescriptor &&
          Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response')?.get ===
            responseProxy
        )
          Object.defineProperty(XMLHttpRequest.prototype, 'response', responseDescriptor);
        for (const [name, entry] of globals) {
          const current = Object.getOwnPropertyDescriptor(window, name);
          if (current?.get !== entry.get || !current.configurable) continue;
          const value = entry.get();
          Object.defineProperty(
            window,
            name,
            entry.descriptor
              ? { ...entry.descriptor, value }
              : { configurable: true, enumerable: true, writable: true, value },
          );
        }
        globals.clear();
        for (const [config, entry] of configs)
          if (config.set === entry.wrapper) config.set = entry.original;
        configs.clear();
        clearInterval(timer);
        clearTimeout(queued);
        queued = undefined;
        observer.disconnect();
        player = null;
        document.removeEventListener('playing', schedule, true);
        document.removeEventListener('loadedmetadata', schedule, true);
        document.removeEventListener('durationchange', schedule, true);
        document.removeEventListener('DOMContentLoaded', schedule);
      }
    },
    stats: () => ({ filteredResponses, skippedAds }),
  };
  Object.defineProperty(window, key, { configurable: true, value: handle });
  handle.configure(initial);
}

export class PlaybackAdBlocker {
  private operation = Promise.resolve();
  private documentId = crypto.randomUUID();
  private enabled: boolean;
  constructor() {
    // One bounded boolean lookup before any site scripts run. The main handler
    // does no I/O or asynchronous work, so boot does not wait for filter loading.
    this.enabled = ipcRenderer.sendSync(IPC.adBlockState) === true;
    this.configure(this.enabled);
    ipcRenderer.on(IPC.adBlockConfigure, (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') return;
      this.enabled = enabled;
      this.configure(enabled);
    });
  }
  private configure(enabled: boolean): void {
    const code = `(${installPlayerAdBlocking.toString()})(${prunePlayerAds.toString()},${canFinishPlaybackAd.toString()},${enabled})`;
    this.operation = this.operation
      .then(async () => {
        await webFrame.executeJavaScriptInIsolatedWorld(0, [{ code }]);
      })
      .catch((error) => console.error('YTMusic+ playback ad blocking:', String(error)));
  }
  async report(): Promise<void> {
    if (!this.enabled) return;
    await this.operation;
    const stats: unknown = await webFrame.executeJavaScriptInIsolatedWorld(0, [
      { code: 'window[Symbol.for("ytmusic-plus.playback-ad-blocker")]?.stats()' },
    ]);
    ipcRenderer.send(IPC.adBlockStats, { documentId: this.documentId, ...(stats as object) });
  }
  dispose(): void {
    this.enabled = false;
    this.configure(false);
  }
}
