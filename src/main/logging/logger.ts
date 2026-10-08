import { appendFile, mkdir, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';

export type LogCategory =
  | 'application'
  | 'youtube-integration'
  | 'plugin-manager'
  | 'plugins'
  | 'listen-together'
  | 'network';
export interface LogEntry {
  time: string;
  category: LogCategory;
  level: 'info' | 'error';
  message: string;
  pluginId?: string;
}
export class Logger {
  readonly entries: LogEntry[] = [];
  private pending = Promise.resolve();
  constructor(readonly directory: string) {}

  log(
    category: LogCategory,
    message: string,
    pluginId?: string,
    level: LogEntry['level'] = 'info',
  ): void {
    const redacted = message
      .replace(/(token|cookie|authorization|password)\s*[:=]\s*[^\s,}]+/gi, '$1=[redacted]')
      .slice(0, 2000);
    const entry: LogEntry = {
      time: new Date().toISOString(),
      category,
      level,
      message: redacted,
      pluginId,
    };
    this.entries.push(entry);
    if (this.entries.length > 500) this.entries.shift();
    this.pending = this.pending
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const path = join(
          this.directory,
          pluginId ? `plugin-${pluginId}.jsonl` : `${category}.jsonl`,
        );
        const size = await stat(path)
          .then((value) => value.size)
          .catch(() => 0);
        if (size > 2_000_000) await rename(path, `${path}.previous`).catch(() => {});
        await appendFile(path, `${JSON.stringify(entry)}\n`);
      })
      .catch(() => {});
  }
}
