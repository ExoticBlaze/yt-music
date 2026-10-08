import type { MusicEvents, PlaybackState, TrackInfo } from '../../src/shared/types/music';
import type { AppSettings } from '../../src/shared/types/settings';
import type { LyricLine, PanelDefinition } from '../../src/shared/types/ui';
import type { RoomSnapshot, RoomClientMessage } from '../../src/shared/types/rooms';
import type { BlockingStatus } from '../../src/shared/types/blocking';
import type { CrossfadeConfig, CrossfadeStatus } from '../../src/shared/types/crossfade';

export type Cleanup = () => void;
export type Action = (value?: string | number | boolean) => void | Promise<void>;
export type PluginEvents = MusicEvents & { settingsChanged: AppSettings };
export interface PlayerAPI {
  getCurrentTrack(): Promise<TrackInfo | null>;
  getPlaybackState(): Promise<PlaybackState>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  openTrack(videoId: string, playlistId?: string): Promise<void>;
}
export interface UIButton {
  id: string;
  label?: string;
  icon?: string;
  tooltip?: string;
  onClick: Action;
}
export interface UIAPI {
  addPlayerButton(button: UIButton): Cleanup;
  addSidebarItem(button: UIButton): Cleanup;
  addMenuItem(button: UIButton): Cleanup;
  addContextMenuItem(button: UIButton): Cleanup;
  createPanel(panel: PanelDefinition): Cleanup;
  createModal(panel: PanelDefinition): Cleanup;
  createOverlay(panel: PanelDefinition): Cleanup;
  updatePanel(panel: PanelDefinition): Promise<void>;
  openPanel(id: string): Promise<void>;
  createToast(text: string): Promise<void>;
  action(callback: Action, id?: string): string;
  applyCSS(css: string): Promise<void>;
}
export interface PluginContext {
  id: string;
  player: PlayerAPI;
  queue: { get(): Promise<TrackInfo[]>; play(index: number): Promise<void> };
  events: {
    on<K extends keyof PluginEvents>(
      event: K,
      callback: (value: PluginEvents[K]) => void | Promise<void>,
    ): Cleanup;
  };
  ui: UIAPI;
  settings: {
    get(): Promise<AppSettings>;
    updateAppearance(value: Partial<AppSettings['appearance']>): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  network: {
    fetch(
      url: string,
      options?: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
    ): Promise<{ status: number; body: string }>;
  };
  notifications: { show(title: string, body: string): Promise<void> };
  clipboard: { writeText(text: string): Promise<void> };
  filesystem: { importText(extensions?: string[]): Promise<{ name: string; text: string } | null> };
  presence: { set(clientId: string, activity: PresenceActivity | null): Promise<void> };
  themes: {
    list(): Promise<{ id: string; name: string }[]>;
    select(id: string): Promise<void>;
    importPackage(): Promise<void>;
  };
  rooms: {
    send(message: RoomClientMessage): Promise<void>;
    onUpdate(callback: (room: RoomSnapshot) => void | Promise<void>): Cleanup;
    disconnect(): Promise<void>;
  };
  blocking: {
    status(): Promise<BlockingStatus>;
    enable(enabled: boolean): Promise<BlockingStatus>;
    updateFilters(): Promise<BlockingStatus>;
  };
  audio: {
    crossfade: {
      status(): Promise<CrossfadeStatus>;
      configure(value: CrossfadeConfig): Promise<CrossfadeStatus>;
    };
  };
  commands: { register(command: { id: string; name: string; execute: Action }): Cleanup };
  shortcuts: { register(shortcut: { id: string; accelerator: string; execute: Action }): Cleanup };
  log(message: string): void;
  onCleanup(cleanup: () => void | Promise<void>): void;
}
export interface PresenceActivity {
  details?: string;
  state?: string;
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string };
  buttons?: { label: string; url: string }[];
}
export interface YTMusicPlugin {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  onLoad?(): void | Promise<void>;
  onEnable?(): void | Promise<void>;
  onDisable?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}
export interface LyricsResult {
  lines: LyricLine[];
  synced: boolean;
  provider: string;
  instrumental?: boolean;
}
export interface LyricsProvider {
  id: string;
  name: string;
  search(track: TrackInfo): Promise<LyricsResult | null>;
}
