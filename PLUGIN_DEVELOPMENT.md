# Building a plugin

## Package

```text
my-plugin/
  manifest.json
  index.js             bundled browser ESM
  style.css            optional source asset
```

Keep source TypeScript wherever you prefer. The `plugins/example-plugin/src/` directory contains a complete example split into lifecycle, panel and settings modules. Install the compiled folder or a ZIP through the graphical manager. IDs must be unique, entry points must stay inside the package, and version ranges must match the app.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "An example extension.",
  "author": "You",
  "main": "index.js",
  "ytmusicPlus": ">=1.0.0",
  "permissions": ["player.read", "ui.overlay", "settings.read", "settings.write"],
  "networkDomains": []
}
```

## Typed SDK and lifecycle

Run `npm run build:sdk` at the repository root. Install the SDK directory or its `npm pack` archive into an external project. The distributable declaration package includes its shared types; it does not depend on this repository's source paths at install time.

```ts
import type { YTMusicPlugin } from '@ytmusic-plus/plugin-sdk';

const plugin: YTMusicPlugin = {
  async activate(ctx) {
    const offset = (await ctx.storage.get<number>('offset')) ?? 0;
    await ctx.storage.set('offset', offset);
    ctx.onCleanup(
      ctx.events.on('trackChanged', (track) => {
        ctx.log(`Track: ${track?.title ?? 'none'}`);
      }),
    );
  },
  async deactivate() {
    // Release resources that were not registered with onCleanup.
  },
};

export default plugin;
```

Build as **browser ESM**, for example `esbuild src/index.ts --bundle --platform=browser --format=esm --outfile=index.js`. The host calls `onLoad → activate → onEnable`, then `onDisable → deactivate → onUnload` on orderly disable/reload. Activation has a ten-second timeout, deactivation a one-second grace period, and running sandboxes have heartbeats. Unhandled lifecycle/event/action errors are logged and disable the failed sandbox. Handle expected user/network errors yourself and show a useful toast.

Event subscription returns an unsubscribe function. Use `ctx.onCleanup()` for intervals, subscriptions and other resources. Cleanup callbacks can return a promise; the runtime awaits them before acknowledging shutdown, within the host's bounded stop deadline. The host removes contributions, CSS, room connections and native presence connections even after a crash. A plugin cannot obtain Node, Electron, another plugin's session/storage, or Google cookies.

## Permissions

| Permission      | Capability                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| player.read     | Playback state, track and playback events                                                                               |
| player.control  | Play, pause, toggle, seek, next, previous, volume, bounded sync rate, exact-track navigation                            |
| queue.read      | Observed native queue metadata and queueChanged events                                                                  |
| queue.modify    | Activate an observed native queue item                                                                                  |
| ui.inject       | Player/sidebar controls, application overlay and trusted website CSS                                                    |
| ui.overlay      | Panels/modals, menu/context entries, commands and toasts                                                                |
| settings.read   | App settings and the plugin's isolated storage reads; settingsChanged events                                            |
| settings.write  | Isolated storage mutation; appearance changes additionally need ui.inject                                               |
| network         | Anonymous brokered HTTPS to exact declared domains                                                                      |
| notifications   | Native desktop notifications, subject to app settings                                                                   |
| clipboard       | Write text; no clipboard-read capability                                                                                |
| filesystem      | User-confirmed text import and theme package import; no arbitrary paths                                                 |
| presence        | Brokered Discord desktop IPC; no Discord token                                                                          |
| rooms           | Validated messages to the user's configured room relay                                                                  |
| web.blocking    | Enable the app-managed music-session ad filter, read aggregate counts, update fixed-source EasyList rules               |
| audio.crossfade | Read crossfade status and configure the app-managed native audio transition; configuration also requires player.control |

All requested permissions must be declared and granted. Built-in plugins run through the same runtime/broker as external plugins. Core implements only capabilities that need a native boundary. Third-party installation asks for approval and stores a digest of the approved manifest. Changed permission/domain/version manifests invalidate that approval.

## Player and events

With `web.blocking`, use `ctx.blocking.enable(true)`, `ctx.blocking.status()` and `ctx.blocking.updateFilters()`. The API is available from YTMusic+ 1.1.0; declare `ytmusicPlus: ">=1.1.0"`. Ownership is removed automatically on plugin disable/crash. It does not expose request contents, headers, cookies, arbitrary rules or network hooks.

YTMusic+ 1.4.1 adds playback ad-response filtering and native ad skipping to the same enable switch. Status includes `filteredResponses` and `skippedAds` session counters alongside `blockedRequests`; declare `ytmusicPlus: ">=1.4.1"` when using the new fields. Disabling the last owner restores native parsing and removes the skip observers. Access restrictions, streaming data and license information are preserved.

With `audio.crossfade` and `player.control`, use `ctx.audio.crossfade.configure({ enabled: true, seconds: 5 })`; `seconds` must be an integer from 0 to 12. `ctx.audio.crossfade.status()` returns the configuration, phase and optional fallback message. This API requires YTMusic+ 1.4.0. Only one plugin can own crossfade at a time. Register a cleanup callback that configures `enabled: false`; the host also releases ownership and restores native gain on crashes. Fade curves, hidden players and buffering belong to the core, and the plugin cannot access media sources or audio samples.

```ts
const state = await ctx.player.getPlaybackState();
const track = await ctx.player.getCurrentTrack();
await ctx.player.play();
await ctx.player.pause();
await ctx.player.togglePlay();
await ctx.player.seek(30);
await ctx.player.next();
await ctx.player.previous();
await ctx.player.setVolume(0.5);
await ctx.player.openTrack('abcdefghijk');
const queue = await ctx.queue.get();
await ctx.queue.play(0);
```

Events: `trackChanged`, `playbackStarted`, `playbackPaused`, `playbackStopped`, `positionChanged`, `volumeChanged`, `queueChanged`, `navigationChanged`, `likeStateChanged`, `stateChanged`, and `settingsChanged`. Queue visibility is permission-filtered. Events are normalized by the central adapter; plugins have no access to the remote webpage DOM.

## Stable UI

Use declarative nodes rather than arbitrary HTML. Text is escaped by the renderer. Supported nodes are text, button, input/multiline input, toggle, range, select, lyrics, participants, code and divider.

In YTMusic+ 1.2+, a panel can set `placement: 'native-lyrics'` to render in the website's existing Lyrics tab. This requires `ui.inject`. `openPanel` opens the native tab without reserving an application sidebar. Descriptor actions remain validated by the main process and native content is restored on disable. Ordinary panels use the default sidebar placement.

```ts
const refresh = ctx.ui.action(async () => {
  await ctx.ui.createToast('Refreshed');
}, 'refresh');

ctx.ui.createPanel({
  id: 'my-panel',
  title: 'My panel',
  nodes: [{ type: 'button', label: 'Refresh', action: refresh }],
});
ctx.ui.addPlayerButton({
  id: 'my-player-button',
  icon: 'puzzle',
  label: 'My plugin',
  onClick: () => ctx.ui.openPanel('my-panel'),
});
ctx.commands.register({
  id: 'my-plugin.open',
  name: 'Open My Plugin',
  execute: () => ctx.ui.openPanel('my-panel'),
});
```

`createPanel`, `createModal`, `createOverlay` and contribution registrations return removal functions and are automatically cleaned up. `updatePanel` replaces its descriptor. `ui.action(callback, stableId)` replaces a named callback when reused; use stable IDs or create actions once to avoid accumulating callbacks in frequently refreshed panels. `addSidebarItem`, `addMenuItem` and `addContextMenuItem` use the same button descriptor. Sidebar entries live in a separate extension rail beside the website; context entries are available from the player extension dock's context menu. Commands appear in Ctrl+K. The `app.` namespace is reserved.

Register a shortcut with `ctx.shortcuts.register({ id, accelerator, execute })`. Bindings are local to the app, and conflicts are reported. Users can override command bindings in settings. No raw IPC channel, HTML injection or Electron object is available to plugin code.

## Network and storage

```ts
const response = await ctx.network.fetch('https://api.example.com/data');
if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
const data: unknown = JSON.parse(response.body);
// Validate the provider's data before using it.
```

Declare `network` and `networkDomains: ["api.example.com"]`. Requests have no Google session/cookies, no automatic redirects, exact-domain checks, public-address checks with pinned DNS resolution, a ten-second timeout and a 2 MB response limit. Only GET/POST and Accept/Content-Type headers are supported. Direct fetch/WebSocket/worker/frame access is blocked in the sandbox.

Storage is JSON, per-plugin, limited to 5 MB. `get`, `set` and `remove` never accept another plugin's ID or a filesystem path. Text import opens a native file picker and limits the result to 1 MB. Native notifications and clipboard writes also require grants.

## Lyrics providers

The Lyrics plugin exposes a provider interface in the SDK and has a registry in `plugins/lyrics/src/service.ts`:

```ts
interface LyricsProvider {
  id: string;
  name: string;
  search(track: TrackInfo): Promise<LyricsResult | null>;
}
```

Add providers through the registry and provider selection UI. The built-in implementations are LRCLIB and user-imported `.lrc`/`.txt`; local files are tried first in Automatic mode. Results contain normalized `LyricLine` timestamps with optional translation and romanized text. Cache keys use artist/title/album/rounded duration and provider selection. Cache lifetime is seven days, capped at thirty entries. Refresh or importing a file clears the provider cache. Respect each provider's licensing, API and terms.

## Themes and CSS

`ctx.ui.applyCSS(css)` applies owner-scoped CSS to the website and removes it on disable. This is a trusted CSS capability; URLs and imports in CSS can contact external hosts. `ctx.settings.updateAppearance()` changes typed appearance settings. Theme selection/import is available through `ctx.themes.list()`, `select(id)` and `importPackage()`.

A theme ZIP/folder contains:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "type": "theme",
  "css": "theme.css"
}
```

Use variables `--ytmusic-plus-accent`, `--ytmusic-plus-background`, `--ytmusic-plus-surface`, `--ytmusic-plus-radius` and `--ytmusic-plus-blur`. YouTube selectors can change; prefer these variables. Custom CSS is applied by the Custom CSS plugin through the same public API and is removed when that plugin is disabled.

## Rooms and presence

`ctx.rooms.send(message)`, `onUpdate(callback)` and `disconnect()` use validated SDK protocol types. `RoomTransport` is replaceable; the first implementation uses a WebSocket relay. Audio stays in each account's website session. Roles are authorized by the relay. See DEVELOPMENT.md for clock/drift behavior.

`ctx.presence.set(publicApplicationId, activity)` sets or clears a bounded Discord activity over a native broker. The Discord plugin is the reference implementation. A private-session flag is controlled by the user; the app does not infer Google's browsing mode.
