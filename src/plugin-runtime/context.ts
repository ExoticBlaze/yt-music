import type { Action, PluginContext, PluginEvents } from '../../plugin-sdk/index';
import type { PlaybackState, PlayerCommand } from '../shared/types/music';
import type { PluginCall } from '../shared/types/plugin-rpc';
import type { PluginManifest } from '../shared/types/plugin';
import type { RoomSnapshot } from '../shared/types/rooms';

export interface RuntimeBridge {
  bootstrap(): Promise<PluginManifest>;
  call(request: PluginCall): Promise<unknown>;
  report(status: string, error?: string): void;
  onEvent(callback: (event: string, payload: unknown) => void): void;
  onAction(callback: (id: string, value?: string | number | boolean) => void): void;
  onLifecycle(callback: (action: 'stop' | 'ping') => void): void;
}
declare global {
  interface Window {
    pluginBridge: RuntimeBridge;
  }
}

export function createContext(manifest: PluginManifest): {
  context: PluginContext;
  cleanup: () => Promise<void>;
} {
  const bridge = window.pluginBridge;
  const actions = new Map<string, Action>();
  const listeners = new Map<string, Set<(value: never) => void | Promise<void>>>();
  const cleanups: (() => void | Promise<void>)[] = [];
  let sequence = 0;
  const call = <T>(request: PluginCall) => bridge.call(request) as Promise<T>;
  const fire = (request: PluginCall) => {
    void call(request).catch((error) => bridge.report('error', String(error)));
  };
  const action = (callback: Action, name?: string) => {
    const id = name ? `action:${name}` : `action-${++sequence}`;
    actions.set(id, callback);
    return id;
  };
  const on = <T>(name: string, callback: (value: T) => void | Promise<void>) => {
    const set = listeners.get(name) ?? new Set();
    set.add(callback as (value: never) => void);
    listeners.set(name, set);
    return () => {
      set.delete(callback as (value: never) => void);
    };
  };
  bridge.onAction((id, value) => {
    Promise.resolve()
      .then(() => actions.get(id)?.(value))
      .catch((error) => bridge.report('error', String(error)));
  });
  bridge.onEvent((name, value) => {
    for (const listener of listeners.get(name) ?? [])
      Promise.resolve()
        .then(() => listener(value as never))
        .catch((error) => bridge.report('error', String(error)));
  });
  const command = (value: PlayerCommand) => call<void>({ type: 'player.command', command: value });
  const contribute = (
    slot: 'player' | 'sidebar' | 'menu' | 'context' | 'command',
    item: {
      id: string;
      label: string;
      icon?: string;
      tooltip?: string;
      callback: Action;
      shortcut?: string;
    },
  ) => {
    const callbackId = action(item.callback);
    fire({
      type: 'ui.contribution',
      contribution: {
        id: item.id,
        label: item.label,
        icon: item.icon,
        tooltip: item.tooltip,
        action: callbackId,
        slot,
        shortcut: item.shortcut,
      },
    });
    const remove = () => {
      actions.delete(callbackId);
      fire({ type: 'ui.remove', id: item.id });
    };
    cleanups.push(remove);
    return remove;
  };
  const addButton =
    (slot: 'player' | 'sidebar' | 'menu' | 'context'): PluginContext['ui']['addPlayerButton'] =>
    (item) =>
      contribute(slot, {
        ...item,
        label: item.label ?? item.tooltip ?? item.id,
        callback: item.onClick,
      });
  const createPanel: PluginContext['ui']['createPanel'] = (panel) => {
    fire({ type: 'ui.panel', panel });
    const remove = () => fire({ type: 'ui.remove', id: panel.id });
    cleanups.push(remove);
    return remove;
  };
  const context: PluginContext = {
    id: manifest.id,
    player: {
      getPlaybackState: () => call<PlaybackState>({ type: 'player.state' }),
      getCurrentTrack: async () => (await call<PlaybackState>({ type: 'player.state' })).track,
      play: () => command({ type: 'play' }),
      pause: () => command({ type: 'pause' }),
      togglePlay: () => command({ type: 'togglePlay' }),
      next: () => command({ type: 'next' }),
      previous: () => command({ type: 'previous' }),
      seek: (value) => command({ type: 'seek', value }),
      setVolume: (value) => command({ type: 'setVolume', value }),
      setPlaybackRate: (value) => command({ type: 'setRate', value }),
      openTrack: (videoId, playlistId) => command({ type: 'openTrack', videoId, playlistId }),
    },
    queue: {
      get: () => call({ type: 'queue.read' }),
      play: (index) => call({ type: 'queue.play', index }),
    },
    events: {
      on: <K extends keyof PluginEvents>(
        name: K,
        callback: (value: PluginEvents[K]) => void | Promise<void>,
      ) => on(name, callback),
    },
    ui: {
      addPlayerButton: addButton('player'),
      addSidebarItem: addButton('sidebar'),
      addMenuItem: addButton('menu'),
      addContextMenuItem: addButton('context'),
      createPanel,
      createModal: (panel) => createPanel({ ...panel, kind: 'modal' }),
      createOverlay: (panel) => createPanel({ ...panel, kind: 'overlay' }),
      updatePanel: (panel) => call({ type: 'ui.panel', panel }),
      openPanel: (id) => call({ type: 'ui.open', id }),
      createToast: (text) => call({ type: 'ui.toast', text }),
      action,
      applyCSS: (css) => call({ type: 'ui.css', css }),
    },
    settings: {
      get: () => call({ type: 'settings.read' }),
      updateAppearance: (value) => call({ type: 'settings.appearance', value }),
    },
    storage: {
      get: (key) => call({ type: 'storage.get', key }),
      set: (key, value) => call({ type: 'storage.set', key, value: value as never }),
      remove: (key) => call({ type: 'storage.remove', key }),
    },
    network: { fetch: (url, options) => call({ type: 'network.fetch', url, options }) },
    notifications: { show: (title, body) => call({ type: 'notification', title, body }) },
    clipboard: { writeText: (text) => call({ type: 'clipboard', text }) },
    filesystem: {
      importText: (extensions = ['txt']) => call({ type: 'filesystem.import', extensions }),
    },
    presence: { set: (clientId, activity) => call({ type: 'presence', clientId, activity }) },
    themes: {
      list: () => call({ type: 'themes.list' }),
      select: (id) => call({ type: 'themes.select', id }),
      importPackage: () => call({ type: 'themes.import' }),
    },
    rooms: {
      send: (message) => call({ type: 'rooms.send', message }),
      onUpdate: (callback) => on<RoomSnapshot>('roomUpdated', callback),
      disconnect: () => call({ type: 'rooms.disconnect' }),
    },
    blocking: {
      status: () => call({ type: 'blocking.status' }),
      enable: (enabled) => call({ type: 'blocking.enable', enabled }),
      updateFilters: () => call({ type: 'blocking.update' }),
    },
    audio: {
      crossfade: {
        status: () => call({ type: 'crossfade.status' }),
        configure: (value) => call({ type: 'crossfade.configure', value }),
      },
    },
    commands: {
      register: (item) =>
        contribute('command', { id: item.id, label: item.name, callback: item.execute }),
    },
    shortcuts: {
      register: (item) =>
        contribute('command', {
          id: item.id,
          label: item.id,
          callback: item.execute,
          shortcut: item.accelerator,
        }),
    },
    log: (message) => fire({ type: 'log', message }),
    onCleanup: (cleanup) => cleanups.push(cleanup),
  };
  return {
    context,
    cleanup: async () => {
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch {}
      }
      actions.clear();
      listeners.clear();
    },
  };
}
