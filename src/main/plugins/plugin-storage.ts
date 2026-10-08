import { z } from 'zod';
import { JsonStore } from '../settings/json-store';

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export class PluginStorage {
  private readonly store: JsonStore<Record<string, JsonValue>>;
  private writes = Promise.resolve();
  constructor(path: string) {
    this.store = new JsonStore(
      path,
      (value) => {
        if (JSON.stringify(value).length > 5_000_000)
          throw new Error('Plugin storage quota exceeded (5 MB)');
        return z.record(z.string(), z.json()).parse(value);
      },
      {},
    );
  }
  async load(): Promise<void> {
    await this.store.load();
  }
  get(key: string): unknown {
    return this.store.get()[key];
  }
  async set(key: string, value: JsonValue | undefined): Promise<void> {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new Error('Reserved storage key');
    const operation = this.writes.then(async () => {
      const data = this.store.get();
      if (value === undefined) delete data[key];
      else data[key] = value;
      await this.store.set(data);
    });
    this.writes = operation.catch(() => {});
    await operation;
  }
}
