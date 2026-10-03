import type { ActiveRun } from './runtime.js';

/** Tracks process authority without coupling cleanup to Electron IPC. */
export class ActiveRunRegistry {
  readonly #runs = new Map<string, ActiveRun>();

  get size(): number {
    return this.#runs.size;
  }

  track(run: ActiveRun): void {
    this.#runs.set(run.runId, run);
    void run.completion.then(
      () => this.#runs.delete(run.runId),
      () => this.#runs.delete(run.runId),
    );
  }

  cancel(runId: string): void {
    this.#runs.get(runId)?.cancel();
  }

  cancelAll(): void {
    for (const run of this.#runs.values()) run.cancel();
  }
}
