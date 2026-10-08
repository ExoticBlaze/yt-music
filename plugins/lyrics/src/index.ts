import type { YTMusicPlugin, LyricsResult, TrackInfo, UINode } from '../../../plugin-sdk/index';
import { LocalLyricsProvider, LRCLibProvider } from './providers';
import { LyricsService } from './service';

interface LyricsSettings {
  provider: string;
  fontSize: number;
  align: 'left' | 'center';
  offset: number;
  translation: boolean;
  romanized: boolean;
}
const defaults: LyricsSettings = {
  provider: 'auto',
  fontSize: 26,
  align: 'left',
  offset: 0,
  translation: false,
  romanized: false,
};
const plugin: YTMusicPlugin = {
  async activate(context) {
    let settings = {
      ...defaults,
      ...(await context.storage.get<Partial<LyricsSettings>>('settings')),
    };
    let track: TrackInfo | null = await context.player.getCurrentTrack();
    let result: LyricsResult | null = null;
    let message = 'Play a song to find its lyrics.';
    let generation = 0;
    const local = new LocalLyricsProvider(context);
    const service = new LyricsService(context, [local, new LRCLibProvider(context)]);
    const save = async (
      key: keyof LyricsSettings,
      value: string | number | boolean | undefined,
    ) => {
      settings = { ...settings, [key]: value };
      await context.storage.set('settings', settings);
      await render();
    };
    const actions = {
      provider: context.ui.action(async (value) => {
        await save('provider', String(value));
        await load(track);
      }),
      fontSize: context.ui.action((value) => save('fontSize', Number(value))),
      align: context.ui.action((value) => save('align', String(value))),
      offset: context.ui.action((value) => save('offset', Number(value))),
      translation: context.ui.action((value) => save('translation', Boolean(value))),
      romanized: context.ui.action((value) => save('romanized', Boolean(value))),
      seek: context.ui.action((value) =>
        context.player.seek(Math.max(0, Number(value) - settings.offset / 1000)),
      ),
      import: context.ui.action(async () => {
        if (!track) {
          await context.ui.createToast('Play a song before importing lyrics.');
          return;
        }
        if (await local.import(track)) {
          await service.clearCache();
          await load(track);
        }
      }),
      retry: context.ui.action(async () => {
        await service.clearCache();
        await load(track);
      }),
    };
    async function render(): Promise<void> {
      const nodes: UINode[] = [
        {
          type: 'text',
          text: track ? `${track.title}\n${track.artist}` : 'Your words, in time with your music.',
          tone: 'muted',
        },
      ];
      if (result?.synced)
        nodes.push({
          type: 'lyrics',
          lines: result.lines,
          offset: settings.offset,
          fontSize: settings.fontSize,
          align: settings.align,
          translation: settings.translation,
          romanized: settings.romanized,
          seekAction: actions.seek,
        });
      else if (result?.lines.length)
        nodes.push({ type: 'text', text: result.lines.map((line) => line.text).join('\n') });
      else
        nodes.push({
          type: 'text',
          text: result?.instrumental ? 'Instrumental · let the music speak.' : message,
          tone: 'muted',
        });
      if (result)
        nodes.push({
          type: 'text',
          text: `${result.synced ? 'Synced' : 'Plain'} lyrics · ${result.provider}`,
          tone: 'muted',
        });
      nodes.push(
        { type: 'divider' },
        {
          type: 'select',
          id: 'provider',
          label: 'Provider',
          value: settings.provider,
          options: [
            { value: 'auto', label: 'Automatic' },
            ...service.listProviders().map(({ id, name }) => ({ value: id, label: name })),
          ],
          action: actions.provider,
        },
        {
          type: 'range',
          id: 'font-size',
          label: 'Text size',
          value: settings.fontSize,
          min: 14,
          max: 42,
          action: actions.fontSize,
        },
        {
          type: 'select',
          id: 'align',
          label: 'Alignment',
          value: settings.align,
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centered' },
          ],
          action: actions.align,
        },
        {
          type: 'range',
          id: 'offset',
          label: 'Offset (ms)',
          value: settings.offset,
          min: -5000,
          max: 5000,
          step: 100,
          action: actions.offset,
        },
      );
      if (result?.lines.some((line) => line.translation))
        nodes.push({
          type: 'toggle',
          id: 'translation',
          label: 'Translation',
          value: settings.translation,
          action: actions.translation,
        });
      if (result?.lines.some((line) => line.romanized))
        nodes.push({
          type: 'toggle',
          id: 'romanized',
          label: 'Romanized',
          value: settings.romanized,
          action: actions.romanized,
        });
      nodes.push(
        { type: 'button', label: 'Import .lrc / .txt', action: actions.import },
        { type: 'button', label: 'Refresh lyrics', action: actions.retry },
      );
      await context.ui.updatePanel({
        id: 'lyrics',
        title: 'Lyrics',
        subtitle: 'EVERY WORD, EVERY FEELING',
        placement: 'native-lyrics',
        nodes,
      });
    }
    async function load(nextTrack: TrackInfo | null): Promise<void> {
      track = nextTrack;
      result = null;
      const request = ++generation;
      message = nextTrack ? 'Finding the words…' : 'Play a song to find its lyrics.';
      await render();
      if (!nextTrack) return;
      try {
        const found = await service.find(nextTrack, settings.provider);
        if (request !== generation) return;
        result = found;
        message = 'No lyrics found. You can import your own LRC file.';
      } catch (error) {
        if (request !== generation) return;
        message = `Lyrics unavailable: ${String(error)}. Try a local LRC file.`;
      }
      await render();
    }
    await render();
    const open = () => context.ui.openPanel('lyrics');
    context.ui.addPlayerButton({
      id: 'lyrics-button',
      label: 'Lyrics',
      icon: 'lyrics',
      tooltip: 'Toggle lyrics · Ctrl+Shift+L',
      onClick: open,
    });
    context.commands.register({ id: 'lyrics.toggle', name: 'Toggle Lyrics', execute: open });
    context.onCleanup(context.events.on('trackChanged', load));
    context.onCleanup(() => {
      generation++;
    });
    void load(track);
  },
};
export default plugin;
