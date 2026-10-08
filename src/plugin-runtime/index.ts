import { createContext } from './context';
import type { YTMusicPlugin } from '../../plugin-sdk/index';

const bridge = window.pluginBridge;
window.addEventListener('error', (event) => bridge.report('error', event.message));
window.addEventListener('unhandledrejection', (event) =>
  bridge.report('error', String(event.reason)),
);
try {
  const manifest = await bridge.bootstrap();
  const module = (await import(`/package/${manifest.main}`)) as { default: YTMusicPlugin };
  const plugin = module.default;
  if (!plugin || typeof plugin.activate !== 'function')
    throw new Error('Plugin must export a default object with activate(context)');
  const { context, cleanup } = createContext(manifest);
  bridge.onLifecycle(async (action) => {
    if (action === 'ping') {
      bridge.report('heartbeat');
      return;
    }
    try {
      await plugin.onDisable?.();
      await plugin.deactivate?.();
      await plugin.onUnload?.();
    } catch (error) {
      context.log(String(error));
    } finally {
      await cleanup();
      bridge.report('stopped');
    }
  });
  await plugin.onLoad?.();
  await plugin.activate(context);
  await plugin.onEnable?.();
  bridge.report('enabled');
} catch (error) {
  bridge.report('error', String(error));
}
