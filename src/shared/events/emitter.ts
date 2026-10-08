export class TypedEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();

  on<K extends keyof Events>(event: K, callback: (value: Events[K]) => void): () => void {
    const callbacks = this.listeners.get(event) ?? new Set();
    callbacks.add(callback as (value: never) => void);
    this.listeners.set(event, callbacks);
    return () => {
      callbacks.delete(callback as (value: never) => void);
      if (!callbacks.size) this.listeners.delete(event);
    };
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const callback of [...(this.listeners.get(event) ?? [])]) {
      try {
        callback(value as never);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}
  clear(): void {
    this.listeners.clear();
  }
}
