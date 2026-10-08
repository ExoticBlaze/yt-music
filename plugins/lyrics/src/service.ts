import type {
  LyricsProvider,
  LyricsResult,
  PluginContext,
  TrackInfo,
} from '../../../plugin-sdk/index';
import { trackKey } from './providers';

interface CachedLyrics {
  result: LyricsResult;
  cachedAt: number;
}
const cacheLifetime = 7 * 24 * 60 * 60 * 1000;
export class LyricsService {
  private readonly providers = new Map<string, LyricsProvider>();
  constructor(
    private readonly context: PluginContext,
    providers: LyricsProvider[],
  ) {
    for (const provider of providers) this.register(provider);
  }
  register(provider: LyricsProvider): void {
    this.providers.set(provider.id, provider);
  }
  listProviders(): { id: string; name: string }[] {
    return [...this.providers.values()].map(({ id, name }) => ({ id, name }));
  }
  async find(track: TrackInfo, selected: string): Promise<LyricsResult | null> {
    const key = `${selected}:${trackKey(track)}`;
    const cache =
      (await this.context.storage.get<Record<string, CachedLyrics>>('lyricsCache')) ?? {};
    const cached = cache[key];
    if (cached && Date.now() - cached.cachedAt < cacheLifetime) return cached.result;
    const providers =
      selected === 'auto'
        ? [...this.providers.values()]
        : [this.providers.get(selected)].filter((value): value is LyricsProvider => !!value);
    let lastError: unknown;
    for (const provider of providers) {
      try {
        const result = await provider.search(track);
        if (!result) continue;
        cache[key] = { result, cachedAt: Date.now() };
        const entries = Object.entries(cache)
          .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
          .slice(0, 30);
        await this.context.storage.set('lyricsCache', Object.fromEntries(entries));
        return result;
      } catch (error) {
        lastError = error;
        this.context.log(`${provider.id}: ${String(error)}`);
      }
    }
    if (lastError) throw lastError;
    return null;
  }
  async clearCache(): Promise<void> {
    await this.context.storage.remove('lyricsCache');
  }
}
