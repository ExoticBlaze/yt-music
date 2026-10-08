# YTMusic+ Plugin SDK

This package is a **type-only SDK**. The host supplies capabilities when it calls `activate(context)`.

Build declarations from the repository root with `npm run build:sdk`, then install this directory in a plugin project using `npm install /path/to/ytmusic-plus/plugin-sdk`. `npm pack` inside this directory produces a distributable package containing all referenced declarations.

```ts
import type { YTMusicPlugin } from '@ytmusic-plus/plugin-sdk';

const plugin: YTMusicPlugin = {
  activate(context) {
    context.onCleanup(
      context.events.on('trackChanged', (track) => {
        context.log(track?.title ?? 'Nothing playing');
      }),
    );
  },
};

export default plugin;
```

Bundle your plugin as browser ESM. It runs in a Chromium sandbox, without Node.js. See the repository's `PLUGIN_DEVELOPMENT.md` for manifests, permissions, UI, lifecycle, storage, networking, themes, and rooms.
