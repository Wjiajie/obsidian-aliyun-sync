type QueueTask<T> = () => Promise<T>;

interface QueueItem<T> {
  task: QueueTask<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class RateLimitQueue {
  private queue: QueueItem<unknown>[] = [];
  private running = false;
  private lastRunAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        const waitMs = Math.max(0, this.minIntervalMs - (Date.now() - this.lastRunAt));
        if (waitMs > 0) {
          await delay(waitMs);
        }
        this.lastRunAt = Date.now();
        try {
          item.resolve(await item.task());
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
