import type { DesktopWindow } from '../windows/desktop-window';
import type { JsonStore } from '../settings/json-store';
import type { AppSettings } from '../../shared/types/settings';
import type { MusicContext } from '../music/context';
import type { PlayerService } from '../music/player-service';
import type { PluginHost } from '../plugins/plugin-host';
import type { OverlayRegistry } from '../plugins/overlay-registry';
import type { PluginInstaller } from '../plugins/plugin-installer';
import type { Logger } from '../logging/logger';
import type { UpdateService } from '../updater/updater';
import type { AppSnapshot } from '../../shared/types/bridge';
import type { ThemeService } from '../settings/theme-service';

export interface AppServices {
  desktop: DesktopWindow;
  settings: JsonStore<AppSettings>;
  music: MusicContext;
  player: PlayerService;
  plugins: PluginHost;
  overlay: OverlayRegistry;
  installer: PluginInstaller;
  logger: Logger;
  updater: UpdateService;
  themes: ThemeService;
  snapshot(): AppSnapshot;
  executeCommand(id: string): Promise<void>;
  broadcast(): void;
  settingsChanged(): void;
}
