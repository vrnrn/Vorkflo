import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkflow } from '../src/shared/defaults';
import {
  clearWorkflowDraft,
  readWorkflowDraft,
  workflowDraftStorageKey,
  writeWorkflowDraft,
  type DraftStorage,
} from '../src/renderer/src/draft-store';

describe('renderer workflow draft storage', () => {
  let storage: MemoryDraftStorage;

  beforeEach(() => {
    storage = new MemoryDraftStorage();
  });

  it('round-trips a canonical workflow and machine-local file path', () => {
    const workflow = { ...createWorkflow(), name: 'Recovered workflow' };

    expect(
      writeWorkflowDraft(
        { workflow, filePath: '/tmp/recovered.vorkflo.json' },
        storage,
        () => new Date('2026-07-09T21:00:00.000Z'),
      ),
    ).toBe(true);
    expect(readWorkflowDraft(storage)).toEqual({
      schemaVersion: 1,
      workflow,
      filePath: '/tmp/recovered.vorkflo.json',
      updatedAt: '2026-07-09T21:00:00.000Z',
    });
  });

  it('rejects and removes malformed or non-workflow records', () => {
    storage.setItem(
      workflowDraftStorageKey,
      JSON.stringify({ updatedAt: 'not-a-date', workflow: {} }),
    );

    expect(readWorkflowDraft(storage)).toBeUndefined();
    expect(storage.getItem(workflowDraftStorageKey)).toBeNull();
  });

  it('keeps the last valid draft when the current edit is invalid', () => {
    const workflow = createWorkflow();
    expect(writeWorkflowDraft({ workflow }, storage)).toBe(true);
    const saved = storage.getItem(workflowDraftStorageKey);

    expect(
      writeWorkflowDraft(
        {
          workflow: { ...workflow, name: '' },
        },
        storage,
      ),
    ).toBe(false);
    expect(storage.getItem(workflowDraftStorageKey)).toBe(saved);

    clearWorkflowDraft(storage);
    expect(readWorkflowDraft(storage)).toBeUndefined();
  });
});

class MemoryDraftStorage implements DraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
