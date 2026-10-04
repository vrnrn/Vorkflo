import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RunHistoryStore } from '../src/main/run-history';
import type { RunHistoryRecord } from '../src/shared/contracts';

describe('local run history', () => {
  it('persists complete records and reloads them by workflow', async () => {
    const filePath = await historyPath();
    const store = new RunHistoryStore(filePath, {
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });
    await store.append(record('run-a', 'workflow-a', '2026-07-09T11:00:00Z'));
    await store.append(record('run-b', 'workflow-b', '2026-07-09T11:30:00Z'));

    const reloaded = new RunHistoryStore(filePath, {
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });
    await expect(reloaded.list('workflow-a')).resolves.toEqual([
      expect.objectContaining({ runId: 'run-a', workflowId: 'workflow-a' }),
    ]);
    expect(await reloaded.list()).toHaveLength(2);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
    });
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('prunes expired and oldest oversized records', async () => {
    const filePath = await historyPath();
    const prototype = record('newest', 'workflow-a', '2026-07-09T11:59:00Z');
    const oneRecordBytes = Buffer.byteLength(
      `${JSON.stringify({ schemaVersion: 1, records: [prototype] })}\n`,
    );
    const store = new RunHistoryStore(filePath, {
      retentionMs: 60 * 60 * 1000,
      maxBytes: oneRecordBytes + 20,
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });

    await store.append(record('expired', 'workflow-a', '2026-07-09T09:00:00Z'));
    await store.append(record('older', 'workflow-a', '2026-07-09T11:30:00Z'));
    await store.append(prototype);

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ runId: 'newest' }),
    ]);
    expect((await readFile(filePath)).byteLength).toBeLessThanOrEqual(
      oneRecordBytes + 20,
    );
  });

  it('removes expired sensitive records from persisted storage during reads', async () => {
    const filePath = await historyPath();
    const initial = new RunHistoryStore(filePath, {
      retentionMs: 60 * 60 * 1000,
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });
    await initial.append(
      record('soon-expired', 'workflow-a', '2026-07-09T11:30:00Z'),
    );

    const later = new RunHistoryStore(filePath, {
      retentionMs: 60 * 60 * 1000,
      now: () => new Date('2026-07-09T13:00:01.000Z'),
    });
    await expect(later.list()).resolves.toEqual([]);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      records: [],
    });
  });

  it('clears one workflow without removing other history', async () => {
    const filePath = await historyPath();
    const store = new RunHistoryStore(filePath, {
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });
    await store.append(record('run-a', 'workflow-a', '2026-07-09T11:00:00Z'));
    await store.append(record('run-b', 'workflow-b', '2026-07-09T11:30:00Z'));

    await store.clear('workflow-a');
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ runId: 'run-b' }),
    ]);
    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('retains discoverability until an isolated worktree is safely cleaned', async () => {
    const filePath = await historyPath();
    const store = new RunHistoryStore(filePath, {
      retentionMs: 1,
      now: () => new Date('2026-07-10T12:00:00.000Z'),
    });
    await store.append(retainedWorktreeRecord());

    await expect(store.list()).resolves.toHaveLength(1);
    await expect(store.clear('workflow-a')).rejects.toThrow(
      'retained worktrees cannot be cleared',
    );
    await store.updateWorktree('worktree-run', 'shared', (worktree) => ({
      ...worktree,
      state: 'cleaned',
    }));
    await expect(store.clear('workflow-a')).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('recovers from corrupt persisted data on the next append', async () => {
    const filePath = await historyPath();
    await writeFile(filePath, '{not-json', 'utf8');
    const store = new RunHistoryStore(filePath, {
      now: () => new Date('2026-07-09T12:00:00.000Z'),
    });

    await expect(store.list()).resolves.toEqual([]);
    await store.append(record('recovered', 'workflow-a'));
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ runId: 'recovered' }),
    ]);
  });

  it('rejects malformed nested artifacts without losing valid neighboring records', async () => {
    const filePath = await historyPath();
    const valid = record('valid', 'workflow-a');
    const artifact = {
      id: 'text-output',
      kind: 'text',
      value: 'Hello 🌱',
      provenance: {
        runId: 'valid',
        blockId: 'block-a',
        portId: 'out',
        createdAt: valid.completedAt,
      },
    };
    const good = {
      ...valid,
      blocks: [
        {
          ...valid.blocks[0]!,
          artifacts: [artifact],
          inputs: { text: artifact },
        },
      ],
    };
    const malformed = [
      null,
      {},
      { ...artifact, provenance: null },
      { ...artifact, value: {} },
      { ...artifact, kind: 'filesystem-reference', path: 123 },
      {
        ...artifact,
        kind: 'filesystem-reference',
        path: '/tmp/file',
        entity: ['file'],
      },
      {
        ...artifact,
        provenance: {
          ...artifact.provenance,
          source: 'workflow-input',
          inputId: 'text',
          valueSource: ['supplied'],
        },
      },
    ];
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        records: [
          good,
          ...malformed.flatMap((bad, index) => [
            {
              ...valid,
              runId: `bad-output-${index}`,
              blocks: [{ ...valid.blocks[0]!, artifacts: [bad] }],
            },
            {
              ...valid,
              runId: `bad-input-${index}`,
              blocks: [{ ...valid.blocks[0]!, inputs: { text: bad } }],
            },
          ]),
        ],
      }),
    );
    const store = new RunHistoryStore(filePath, {
      now: () => new Date(valid.completedAt),
    });
    await expect(store.list()).resolves.toEqual([good]);
  });

  it('counts UTF-8 bytes and commas exactly while preserving retained worktrees', async () => {
    const filePath = await historyPath();
    const protectedRecord = retainedWorktreeRecord();
    const newest = {
      ...record('newest', 'workflow-a', '2026-07-09T11:59:00Z'),
      workflowName: 'Flow 🌱 日本語',
    };
    const records = [
      newest,
      record('middle', 'workflow-a', '2026-07-09T11:30:00Z'),
      protectedRecord,
    ];
    const budget = Buffer.byteLength(
      `${JSON.stringify({ schemaVersion: 1, records: [newest, protectedRecord] })}\n`,
    );
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, records }));
    const options = {
      maxBytes: budget,
      now: () => new Date('2026-07-09T12:00:00Z'),
    };
    await expect(
      new RunHistoryStore(filePath, options).list(),
    ).resolves.toEqual([newest, protectedRecord]);
    expect((await readFile(filePath)).byteLength).toBe(budget);
    await expect(
      new RunHistoryStore(filePath, {
        ...options,
        maxBytes: budget - 1,
      }).list(),
    ).resolves.toEqual([protectedRecord]);
    await expect(
      new RunHistoryStore(filePath, { ...options, maxBytes: 1 }).list(),
    ).resolves.toEqual([protectedRecord]);
  });

  it('propagates filesystem failures instead of treating inaccessible history as empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vorkflo-history-'));
    const store = new RunHistoryStore(directory);
    await expect(store.list()).rejects.toThrow();
    await expect(store.append(record('new', 'workflow-a'))).rejects.toThrow();
  });
});

function retainedWorktreeRecord(): RunHistoryRecord {
  return {
    ...record('worktree-run', 'workflow-a', '2026-07-09T11:00:00Z'),
    worktrees: [
      {
        scopeId: 'shared',
        repositoryRoot: '/workspace/repository',
        baseCommit: 'abc123',
        branchName: 'vorkflo/worktree-run/shared',
        worktreePath: '/workspace/worktrees/worktree-run/shared',
        createdAt: '2026-07-09T10:59:00Z',
        sourceIsDirty: false,
        state: 'retained',
        reason: 'scope-changed',
        status: ' M file.txt',
        headCommit: 'abc123',
        hasChangesFromBase: true,
        nextAction: 'Inspect the diff.',
      },
    ],
  };
}

async function historyPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'vorkflo-history-')), 'runs.json');
}

function record(
  runId: string,
  workflowId: string,
  completedAt = '2026-07-09T11:00:00Z',
): RunHistoryRecord {
  return {
    schemaVersion: 1,
    runId,
    workflowId,
    workflowName: 'Workflow',
    startedAt: '2026-07-09T10:59:00Z',
    completedAt,
    outcome: 'failed',
    runInputs: {
      prompt: { kind: 'text', value: 'sensitive local input' },
    },
    blocks: [
      {
        blockId: 'block-a',
        state: 'failed',
        inputs: {},
        artifacts: [],
        stdout: 'captured output',
        stderr: 'captured diagnostic',
        exitCode: 2,
        failure: {
          code: 'process_exit_nonzero',
          message: 'Process failed.',
        },
      },
    ],
  };
}
