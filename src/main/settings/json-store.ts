import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore<T> {
  private pending: Promise<void> = Promise.resolve();
  constructor(
    readonly path: string,
    private readonly validate: (value: unknown) => T,
    private value: T,
  ) {}

  async load(): Promise<T> {
    try {
      this.value = this.validate(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.get();
  }

  get(): T {
    return structuredClone(this.value);
  }

  async set(value: T): Promise<void> {
    const validated = this.validate(value);
    await this.update(() => validated);
  }

  async update(mutate: (current: T) => T): Promise<void> {
    const operation = this.pending.then(async () => {
      const validated = this.validate(mutate(this.get()));
      const serialized = JSON.stringify(validated, null, 2);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, this.path);
      this.value = validated;
    });
    this.pending = operation.catch(() => {});
    await operation;
  }
}
