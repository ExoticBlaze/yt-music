import type { AppSettings } from './settings';
import type { PlaybackState, PlayerCommand } from './music';
import type { PluginInfo } from './plugin';
import type { OverlayState } from './ui';
import type { LogEntry } from '../../main/logging/logger';

export interface AppSnapshot {
  settings: AppSettings;
  music: PlaybackState;
  account: 'unknown' | 'signedIn' | 'signedOut';
  status: string;
  plugins: PluginInfo[];
  overlay: OverlayState;
  logs: LogEntry[];
}
export type AppRequest =
  | { type: 'toast'; text: string }
  | { type: 'snapshot' }
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'player'; command: PlayerCommand }
  | { type: 'navigation'; action: 'back' | 'forward' | 'reload' | 'home' }
  | { type: 'window'; action: 'minimize' | 'maximize' | 'close' }
  | { type: 'layout'; mode: 'none' | 'panel' | 'full' }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'view'; view: OverlayState['activeView'] }
  | {
      type: 'plugin';
      id: string;
      action: 'enable' | 'disable' | 'reload' | 'uninstall' | 'inspect' | 'folder';
    }
  | { type: 'install'; source: 'zip' | 'folder' }
  | { type: 'pluginAction'; pluginId: string; action: string; value?: string | number | boolean }
  | { type: 'panel'; pluginId: string; id: string }
  | {
      type: 'developer';
      action:
        | 'reloadPlugins'
        | 'devtools'
        | 'musicDevtools'
        | 'exportLogs'
        | 'pluginsFolder'
        | 'importCss'
        | 'checkUpdates';
    }
  | { type: 'command'; id: string };
export interface AppBridge {
  request(request: AppRequest): Promise<unknown>;
  subscribe(callback: (snapshot: AppSnapshot) => void): () => void;
}
declare global {
  interface Window {
    ytmusic: AppBridge;
  }
}
