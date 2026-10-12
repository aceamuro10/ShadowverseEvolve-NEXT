/** Completion of cosmetic batches, including batches published before React has rendered them. */
export class AnimationBarrier {
  private serial = 0;
  private batches = new Map<string, { promise: Promise<void>; resolve(): void; pending: number; timer: ReturnType<typeof setTimeout> }>();

  reserve(): string {
    const key = `animation:${++this.serial}`;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    // An unmounted/superseded render must never strand the presentation queue.
    const timer = setTimeout(() => this.finish(key), 5000);
    this.batches.set(key, { promise, resolve, pending: 1, timer });
    return key;
  }

  task(key: string): () => void {
    const batch = this.batches.get(key);
    if (!batch) return () => {};
    batch.pending++;
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      this.release(key);
    };
  }

  started(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => this.finish(key), 30_000);
    this.release(key);
  }

  private release(key: string): void {
    const batch = this.batches.get(key);
    if (batch && --batch.pending === 0) this.finish(key);
  }

  private finish(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(key);
    batch.resolve();
  }

  wait(): Promise<void> {
    return Promise.all([...this.batches.values()].map((b) => b.promise)).then(() => {});
  }

  reset(): void {
    for (const key of this.batches.keys()) this.finish(key);
  }
}

export const tableAnimations = new AnimationBarrier();
