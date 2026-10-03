import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseWorkflowRunInputs } from '@vorkflo/engine';
import type { RunHistoryRecord } from '../shared/contracts.js';
import type { WorktreeRunRecord } from '../shared/contracts.js';

export const DEFAULT_RUN_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_RUN_HISTORY_MAX_BYTES = 100 * 1024 * 1024;

interface RunHistoryFile {
  readonly schemaVersion: 1;
  readonly records: readonly RunHistoryRecord[];
}

export interface RunHistoryStoreOptions {
  readonly retentionMs?: number;
  readonly maxBytes?: number;
  readonly now?: () => Date;
}

/**
 * Local, sensitive run evidence. This store is intentionally separate from
 * portable workflow files and serializes mutations so concurrent completions
 * cannot overwrite each other.
 */
export class RunHistoryStore {
  readonly #filePath: string;
  readonly #retentionMs: number;
  readonly #maxBytes: number;
  readonly #now: () => Date;
  #mutation = Promise.resolve();

  constructor(filePath: string, options: RunHistoryStoreOptions = {}) {
    this.#filePath = filePath;
    this.#retentionMs = options.retentionMs ?? DEFAULT_RUN_HISTORY_RETENTION_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_RUN_HISTORY_MAX_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  async list(workflowId?: string): Promise<readonly RunHistoryRecord[]> {
    let retained: RunHistoryRecord[] = [];
    await this.#enqueue(async () => {
      const existing = await this.#readRecords();
      retained = this.#pruneBySize(this.#pruneByAge(existing));
      if (retained.length !== existing.length) {
        await this.#writeRecords(retained);
      }
    });
    return retained.filter(
      (record) => workflowId === undefined || record.workflowId === workflowId,
    );
  }

  async append(record: RunHistoryRecord): Promise<void> {
    await this.#enqueue(async () => {
      const existing = this.#pruneByAge(await this.#readRecords()).filter(
        (candidate) => candidate.runId !== record.runId,
      );
      const records = this.#pruneBySize(
        [record, ...existing].sort(compareNewestFirst),
      );
      await this.#writeRecords(records);
    });
  }

  async clear(workflowId?: string): Promise<void> {
    await this.#enqueue(async () => {
      const existing = await this.#readRecords();
      const retained = existing.filter(
        (record) =>
          (workflowId === undefined || record.workflowId === workflowId) &&
          hasRetainedWorktree(record),
      );
      if (retained.length > 0) {
        throw new Error(
          'Run history with retained worktrees cannot be cleared. Inspect and safely clean each retained scope first.',
        );
      }
      if (workflowId === undefined) {
        await this.#writeRecords([]);
        return;
      }
      const records = existing.filter(
        (record) => record.workflowId !== workflowId,
      );
      await this.#writeRecords(records);
    });
  }

  async updateWorktree(
    runId: string,
    scopeId: string,
    update: (current: WorktreeRunRecord) => WorktreeRunRecord,
  ): Promise<WorktreeRunRecord> {
    let updated: WorktreeRunRecord | undefined;
    await this.#enqueue(async () => {
      const records = await this.#readRecords();
      const next = records.map((record) => {
        if (record.runId !== runId || record.worktrees === undefined) {
          return record;
        }
        return {
          ...record,
          worktrees: record.worktrees.map((worktree) => {
            if (worktree.scopeId !== scopeId) return worktree;
            updated = update(worktree);
            return updated;
          }),
        };
      });
      if (updated === undefined) {
        throw new Error(`Run ${runId} has no worktree scope ${scopeId}.`);
      }
      await this.#writeRecords(next);
    });
    return updated!;
  }

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#mutation.then(operation, operation);
    this.#mutation = next.catch(() => undefined);
    await next;
  }

  async #readRecords(): Promise<RunHistoryRecord[]> {
    try {
      const serialized = await readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(serialized) as Partial<RunHistoryFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
        return [];
      }
      return parsed.records.filter(isRunHistoryRecord);
    } catch {
      return [];
    }
  }

  #pruneByAge(records: readonly RunHistoryRecord[]): RunHistoryRecord[] {
    const cutoff = this.#now().getTime() - this.#retentionMs;
    return records
      .filter(
        (record) =>
          hasRetainedWorktree(record) ||
          Date.parse(record.completedAt) >= cutoff,
      )
      .sort(compareNewestFirst);
  }

  #pruneBySize(records: readonly RunHistoryRecord[]): RunHistoryRecord[] {
    const retained = [...records];
    while (
      retained.length > 0 &&
      serializedByteLength(retained) > this.#maxBytes
    ) {
      let removableIndex = -1;
      for (let index = retained.length - 1; index >= 0; index -= 1) {
        if (!hasRetainedWorktree(retained[index]!)) {
          removableIndex = index;
          break;
        }
      }
      if (removableIndex < 0) break;
      retained.splice(removableIndex, 1);
    }
    return retained;
  }

  async #writeRecords(records: readonly RunHistoryRecord[]): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, serializeHistory(records), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.#filePath);
  }
}

function hasRetainedWorktree(record: RunHistoryRecord): boolean {
  return (
    record.worktrees?.some((worktree) => worktree.state === 'retained') ?? false
  );
}

function compareNewestFirst(
  left: RunHistoryRecord,
  right: RunHistoryRecord,
): number {
  return Date.parse(right.completedAt) - Date.parse(left.completedAt);
}

function serializedByteLength(records: readonly RunHistoryRecord[]): number {
  return Buffer.byteLength(serializeHistory(records));
}

function serializeHistory(records: readonly RunHistoryRecord[]): string {
  return `${JSON.stringify({ schemaVersion: 1, records })}\n`;
}

function isRunHistoryRecord(value: unknown): value is RunHistoryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<RunHistoryRecord>;
  if (!(
    record.schemaVersion === 1 &&
    typeof record.runId === 'string' &&
    record.runId.length > 0 &&
    typeof record.workflowId === 'string' &&
    record.workflowId.length > 0 &&
    typeof record.workflowName === 'string' &&
    typeof record.startedAt === 'string' &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    typeof record.completedAt === 'string' &&
    Number.isFinite(Date.parse(record.completedAt)) &&
    (record.outcome === 'succeeded' ||
      record.outcome === 'failed' ||
      record.outcome === 'cancelled') &&
    Array.isArray(record.blocks) &&
    typeof record.runInputs === 'object' &&
    record.runInputs !== null &&
    !Array.isArray(record.runInputs)
  )) {
    return false;
  }

  try {
    parseWorkflowRunInputs(record.runInputs);
  } catch {
    return false;
  }
  return (
    record.blocks.every(isBlockRunSnapshot) &&
    (record.worktrees === undefined ||
      (Array.isArray(record.worktrees) &&
        record.worktrees.every(isWorktreeRunRecord)))
  );
}

function isWorktreeRunRecord(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.scopeId === 'string' &&
    typeof value.repositoryRoot === 'string' &&
    typeof value.baseCommit === 'string' &&
    typeof value.branchName === 'string' &&
    typeof value.worktreePath === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.sourceIsDirty === 'boolean' &&
    (value.state === 'retained' || value.state === 'cleaned') &&
    typeof value.reason === 'string' &&
    typeof value.status === 'string' &&
    typeof value.headCommit === 'string' &&
    typeof value.hasChangesFromBase === 'boolean' &&
    typeof value.nextAction === 'string'
  );
}

function isBlockRunSnapshot(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.blockId === 'string' &&
    value.blockId.length > 0 &&
    (value.state === 'queued' ||
      value.state === 'running' ||
      value.state === 'succeeded' ||
      value.state === 'failed' ||
      value.state === 'skipped' ||
      value.state === 'cancelled') &&
    isPlainRecord(value.inputs) &&
    Array.isArray(value.artifacts) &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string' &&
    (value.exitCode === null || Number.isInteger(value.exitCode)) &&
    (value.startedAt === undefined ||
      (typeof value.startedAt === 'string' &&
        Number.isFinite(Date.parse(value.startedAt)))) &&
    (value.endedAt === undefined ||
      (typeof value.endedAt === 'string' &&
        Number.isFinite(Date.parse(value.endedAt)))) &&
    (value.skipReason === undefined || typeof value.skipReason === 'string') &&
    (value.failure === undefined || isExecutionFailure(value.failure))
  );
}

function isExecutionFailure(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.nextAction === undefined || typeof value.nextAction === 'string') &&
    (value.exitCode === undefined || Number.isInteger(value.exitCode)) &&
    (value.signal === undefined || typeof value.signal === 'string')
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
