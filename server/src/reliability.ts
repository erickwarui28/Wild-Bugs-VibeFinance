import { setTimeout as delay } from "node:timers/promises";

export class BusyError extends Error {
  readonly status = 503;
  constructor(message = "The service is busy. Please retry shortly.") { super(message); this.name = "BusyError"; }
}

export function abortError(): DOMException { return new DOMException("Request cancelled", "AbortError"); }
export function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }

export async function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await delay(ms, undefined, { signal });
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(signal.reason ?? abortError()); };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    // Attach handlers even for already-aborted signals, preventing unhandled late rejections.
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
    if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
  });
}

type Waiter = { owner: string; grant: () => void };

/** Bounded FIFO admission with per-owner fairness and cancellable queued work. */
export class ConcurrencyGate {
  private active = 0;
  private owners = new Map<string, number>();
  private queue: Waiter[] = [];
  constructor(private limits: { active: number; queued: number; waitMs: number; perOwner?: number }) {}

  snapshot() { return { active: this.active, queued: this.queue.length, maximumActive: this.limits.active, maximumQueued: this.limits.queued }; }

  private canStart(owner: string) {
    return this.active < this.limits.active && (this.owners.get(owner) ?? 0) < (this.limits.perOwner ?? this.limits.active);
  }
  private claim(owner: string) { this.active++; this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1); }
  private release(owner: string) {
    this.active--; const count = (this.owners.get(owner) ?? 1) - 1;
    if (count) this.owners.set(owner, count); else this.owners.delete(owner);
    for (let index = 0; index < this.queue.length && this.active < this.limits.active;) {
      const waiter = this.queue[index]!;
      if (this.canStart(waiter.owner)) { this.queue.splice(index, 1); this.claim(waiter.owner); waiter.grant(); }
      else index++;
    }
  }

  async run<T>(owner: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    if (this.canStart(owner)) this.claim(owner);
    else {
      if (this.queue.length >= this.limits.queued) throw new BusyError();
      await new Promise<void>((resolve, reject) => {
        const remove = () => { const index = this.queue.indexOf(waiter); if (index >= 0) this.queue.splice(index, 1); };
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
        const cancel = () => { remove(); cleanup(); reject(signal?.reason ?? abortError()); };
        const waiter: Waiter = { owner, grant: () => { cleanup(); resolve(); } };
        const timer = setTimeout(() => { remove(); cleanup(); reject(new BusyError("The service queue timed out. Please retry shortly.")); }, this.limits.waitMs);
        this.queue.push(waiter);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
    try { signal?.throwIfAborted(); return await work(); }
    finally { this.release(owner); }
  }
}

type SharedTask<T> = { controller: AbortController; promise: Promise<T>; subscribers: number; done: boolean };

/** Cancel the underlying request only when its last interested caller leaves. */
export class CoalescedTasks<T> {
  private pending = new Map<string, SharedTask<T>>();
  async run(key: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    let task = this.pending.get(key);
    if (!task) {
      const controller = new AbortController();
      task = { controller, subscribers: 0, done: false, promise: Promise.resolve().then(() => work(controller.signal)) };
      const current = task;
      current.promise = current.promise.finally(() => { current.done = true; if (this.pending.get(key) === current) this.pending.delete(key); });
      this.pending.set(key, current);
    }
    task.subscribers++;
    try { return await abortable(task.promise, signal); }
    finally {
      task.subscribers--;
      if (!task.done && task.subscribers === 0) {
        if (this.pending.get(key) === task) this.pending.delete(key);
        task.controller.abort(abortError());
      }
    }
  }
}

export class CircuitBreaker {
  private states = new Map<string, { failures: number; openedAt: number; probing: boolean }>();
  constructor(private threshold: number, private cooldownMs: number) {}
  snapshot() {
    return [...this.states].map(([source, state]) => ({ source, failures: state.failures,
      state: state.probing ? "half_open" : state.failures >= this.threshold ? "open" : "closed", openedAt: state.openedAt || null }));
  }
  async run<T>(source: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    const state = this.states.get(source) ?? { failures: 0, openedAt: 0, probing: false };
    this.states.set(source, state);
    if (state.failures >= this.threshold) {
      if (Date.now() - state.openedAt < this.cooldownMs || state.probing) throw new BusyError(`${source} is temporarily unavailable. Please retry later.`);
      state.probing = true;
    }
    try {
      const value = await work(); signal?.throwIfAborted();
      state.failures = 0; state.openedAt = 0; return value;
    } catch (error) {
      if (!signal?.aborted) {
        state.failures++; if (state.failures >= this.threshold) state.openedAt = Date.now();
      }
      throw error;
    } finally { state.probing = false; }
  }
}
