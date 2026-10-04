import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import { normalizeAgentRuntimeWorkflow } from '../../shared/agent-runtime';

export const workflowDraftStorageKey = 'vorkflo:workflow-draft:v1';

export interface WorkflowDraft {
  readonly schemaVersion: 1;
  readonly workflow: WorkflowDefinition;
  readonly filePath?: string;
  readonly updatedAt: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readWorkflowDraft(
  storage?: DraftStorage,
): WorkflowDraft | undefined {
  try {
    storage ??= window.localStorage;
    const serialized = storage.getItem(workflowDraftStorageKey);
    if (serialized === null) return undefined;
    const input: unknown = JSON.parse(serialized);
    if (!isDraftRecord(input)) {
      storage.removeItem(workflowDraftStorageKey);
      return undefined;
    }
    const workflow = normalizeAgentRuntimeWorkflow(
      parseWorkflowDefinition(input.workflow),
    ).workflow;
    return {
      schemaVersion: 1,
      workflow,
      updatedAt: input.updatedAt,
      ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
    };
  } catch {
    try {
      storage?.removeItem(workflowDraftStorageKey);
    } catch {
      // Storage may be unavailable; recovery remains best effort.
    }
    return undefined;
  }
}

export function writeWorkflowDraft(
  draft: Omit<WorkflowDraft, 'schemaVersion' | 'updatedAt'>,
  storage?: DraftStorage,
  now: () => Date = () => new Date(),
): boolean {
  try {
    storage ??= window.localStorage;
    const workflow = parseWorkflowDefinition(draft.workflow);
    const record: WorkflowDraft = {
      schemaVersion: 1,
      workflow,
      updatedAt: now().toISOString(),
      ...(draft.filePath === undefined ? {} : { filePath: draft.filePath }),
    };
    storage.setItem(workflowDraftStorageKey, JSON.stringify(record));
    return true;
  } catch {
    // Keep the last valid draft when a field is temporarily invalid or storage
    // is unavailable.
    return false;
  }
}

export function clearWorkflowDraft(storage?: DraftStorage): void {
  try {
    storage ??= window.localStorage;
    storage.removeItem(workflowDraftStorageKey);
  } catch {
    // Draft cleanup is best effort and must not block save/open/new.
  }
}

function isDraftRecord(input: unknown): input is {
  readonly workflow: unknown;
  readonly schemaVersion: 1;
  readonly filePath?: string;
  readonly updatedAt: string;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const record = input as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    (record.filePath !== undefined && typeof record.filePath !== 'string')
  ) {
    return false;
  }
  return (
    Object.hasOwn(record, 'workflow') &&
    Object.keys(record).every((key) =>
      ['schemaVersion', 'workflow', 'filePath', 'updatedAt'].includes(key),
    )
  );
}
