import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesktopWindow } from '../../src/main/windows/desktop-window';
import type { PluginHost } from '../../src/main/plugins/plugin-host';
import type { OverlayRegistry } from '../../src/main/plugins/overlay-registry';
import { captureScreenshot } from './capture';
import { APP_VERSION } from '../../src/shared/constants/version';

export async function runElectronSmoke(
  desktop: DesktopWindow,
  plugins: PluginHost,
  overlay: OverlayRegistry,
  output: string,
): Promise<void> {
  desktop.window.show();
  desktop.window.restore();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const plugin of plugins.list()) {
    await plugins.enable(plugin.manifest.id);
    if (
      plugins.list().find((value) => value.manifest.id === plugin.manifest.id)?.status !== 'enabled'
    )
      throw new Error(`${plugin.manifest.id} did not activate`);
    await plugins.verifyIsolation(plugin.manifest.id);
  }
  if (plugins.list().length !== 8) throw new Error('Expected eight built-in plugins');
  if (!overlay.get().panels.some((panel) => panel.pluginId === 'example-plugin'))
    throw new Error('Example plugin did not register its panel');
  await plugins.reload('example-plugin');
  await plugins.disable('example-plugin');
  if (overlay.get().contributions.some((value) => value.pluginId === 'example-plugin'))
    throw new Error('Plugin disable did not clean up UI');
  await mkdir(output, { recursive: true });
  overlay.view('plugins');
  await waitForUI(desktop, 'document.querySelectorAll(".plugin-card").length === 8');
  await captureScreenshot(desktop.window, join(output, 'plugins.png'));
  await desktop.window.webContents.executeJavaScript(
    'document.querySelectorAll(".header-action")[2].click()',
  );
  await waitForUI(desktop, 'document.querySelector(".settings-page") !== null');
  await waitForUI(
    desktop,
    `document.querySelector('.app-version')?.textContent === 'YTMusic+ ${APP_VERSION}'`,
  );
  await desktop.window.webContents.executeJavaScript(
    '[...document.querySelectorAll(".settings-tab")].find(node => node.textContent === "Appearance").click()',
  );
  await waitForUI(desktop, 'document.querySelector("#custom-css-editor") !== null');
  await captureScreenshot(desktop.window, join(output, 'settings.png'));
  const bridgeCheck = (await desktop.window.webContents.executeJavaScript(
    '({request: typeof window.ytmusic.request, require: typeof require, process: typeof process})',
  )) as Record<string, string>;
  if (
    bridgeCheck.request !== 'function' ||
    bridgeCheck.require !== 'undefined' ||
    bridgeCheck.process !== 'undefined'
  )
    throw new Error('Shell bridge security check failed');
  console.log(
    'SMOKE_OK: eight sandboxed plugins; enable/reload/disable; UI cleanup; shell bridge; manager and appearance UI',
  );
  overlay.view('music');
  overlay.toast('YTMusic+ native overlay is ready');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const toastText = await desktop.toast.webContents.executeJavaScript(
    'document.querySelector("#native-toast").textContent',
  );
  if (!desktop.toast.getVisible() || toastText !== 'YTMusic+ native overlay is ready')
    throw new Error('Native toast overlay failed');
  let loaded = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      desktop.music.webContents.getURL().startsWith('https://music.youtube.com/') &&
      !desktop.music.webContents.isLoading()
    ) {
      loaded = (await desktop.music.webContents
        .executeJavaScript('document.querySelector("ytmusic-app") !== null')
        .catch(() => false)) as boolean;
      if (loaded) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (loaded) {
    const exposed = (await desktop.music.webContents.executeJavaScript(
      '({require: typeof require, process: typeof process, bridge: typeof window.ytmusic})',
    )) as Record<string, string>;
    if (Object.values(exposed).some((value) => value !== 'undefined'))
      throw new Error('Privileged API leaked into YouTube Music');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await captureScreenshot(desktop.music.webContents, join(output, 'music.png'));
    console.log('MUSIC_OK: real YouTube Music loaded; no privileged API exposed to website');
  } else
    console.log(
      'MUSIC_UNVERIFIED: remote site did not finish loading within the smoke-test deadline',
    );
}
async function waitForUI(desktop: DesktopWindow, expression: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await desktop.window.webContents.executeJavaScript(expression)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`UI did not become ready: ${expression}`);
}
