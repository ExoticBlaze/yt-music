import type { PluginContext } from '../../../plugin-sdk/index';

export async function loadGreeting(context: PluginContext): Promise<string> {
  return (await context.storage.get<string>('greeting')) ?? 'Enjoy the music.';
}
