import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessRunner } from '@vorkflo/engine';
import {
  applyAgentWorktreePreviews,
  finalizeAgentWorktrees,
  preflightAgentWorktrees,
  prepareAgentWorktrees,
} from '../src/main/agent-worktrees';
import { startWorkflowRun } from '../src/main/runtime';
import { WorktreeRuntime } from '../src/main/worktree-runtime';
import { createWorkflow } from '../src/shared/defaults';
import {
  CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
  compileAgentBlock,
  setAgentBlockPresentation,
  type AgentBlockEditorConfig,
} from '../src/shared/agent-runtime';
import type { RunHistoryRecord } from '../src/shared/contracts';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Agent worktree coordinator', () => {
  it('rejects missing run inputs before inspecting or creating worktrees', async () => {
    const runtime = new WorktreeRuntime();
    const preflight = vi.spyOn(runtime, 'preflight');
    const create = vi.spyOn(runtime, 'create');
    const block = agent('agent', 'codex');
    const workflow = setAgentBlockPresentation(
      {
        ...createWorkflow(),
        blocks: [block],
        inputs: [
          { id: 'task', name: 'Task', artifactKind: 'text', required: true },
        ],
      },
      block.id,
      'codex',
      {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/tmp/not-inspected',
        baseRef: 'HEAD',
        scope: 'task',
      },
    );
    await expect(
      prepareAgentWorktrees(workflow, {
        runId: 'invalid-inputs',
        storageRoot: '/tmp/not-created',
        runtime,
      }),
    ).rejects.toThrow('Workflow run inputs are invalid');
    expect(preflight).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('reports the blocker when an earlier scope only has a warning', async () => {
    const runtime = new WorktreeRuntime();
    vi.spyOn(runtime, 'preflight')
      .mockImplementationOnce(async (request) => ({
        repositoryRoot: request.repositoryPath,
        requestedBaseRef: request.baseRef,
        baseCommit: 'base',
        sourceStatus: '',
        sourceIsDirty: false,
        runId: request.runId,
        scopeId: request.scopeId,
        branchName: 'vorkflo/test',
        worktreePath: '/tmp/test-scope',
        participants: [],
      }))
      .mockRejectedValueOnce(new Error('Second scope cannot be resolved.'));
    const create = vi.spyOn(runtime, 'create');
    let workflow = {
      ...createWorkflow(),
      blocks: [agent('first', 'codex'), agent('second', 'codex')],
    };
    for (const block of workflow.blocks) {
      workflow = setAgentBlockPresentation(workflow, block.id, 'codex', {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/tmp/not-inspected',
        baseRef: 'HEAD',
        scope: block.id,
      });
    }
    await expect(
      prepareAgentWorktrees(workflow, {
        runId: 'mixed-issues',
        storageRoot: '/tmp/not-created',
        runtime,
      }),
    ).rejects.toThrow('Second scope cannot be resolved.');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates one shared scope and rewrites ordered Agent working directories', async () => {
    const fixture = await repository();
    const first = agent('first', 'codex', 'workspace-write');
    const second = agent('second', 'antigravity', 'workspace-write', true);
    let workflow = {
      ...createWorkflow(),
      blocks: [first, second],
      connections: [
        {
          id: 'first-to-second',
          from: { blockId: first.id, portId: 'response' },
          to: { blockId: second.id, portId: 'context' },
        },
      ],
    };
    for (const block of workflow.blocks) {
      workflow = setAgentBlockPresentation(
        workflow,
        block.id,
        block.id === first.id ? 'codex' : 'antigravity',
        {
          mode: 'workflow-run-worktree',
          repositoryRoot: fixture.repositoryPath,
          baseRef: 'HEAD',
          scope: 'shared',
        },
      );
    }

    const runtime = new WorktreeRuntime();
    const authority = await preflightAgentWorktrees(workflow, {
      runId: 'run-1',
      storageRoot: fixture.storageRoot,
      runtime,
    });
    expect(authority.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'adapter_worktree_scope_resolved',
        message: expect.stringContaining(authority.scopes[0]!.baseCommit),
      }),
    );
    const prepared = await prepareAgentWorktrees(workflow, {
      runId: 'run-1',
      storageRoot: fixture.storageRoot,
      runtime,
    });

    expect(prepared.scopes).toHaveLength(1);
    expect(
      prepared.workflow.blocks.map(
        (block) => block.invocation.workingDirectory,
      ),
    ).toEqual([
      prepared.scopes[0]!.worktreePath,
      prepared.scopes[0]!.worktreePath,
    ]);
    expect(
      prepared.workflow.blocks[1]!.invocation.arguments.slice(0, 2),
    ).toEqual([
      { type: 'literal', value: '--add-dir' },
      { type: 'literal', value: prepared.scopes[0]!.worktreePath },
    ]);
    expect(
      applyAgentWorktreePreviews(
        [
          {
            blockId: first.id,
            executable: 'codex',
            workingDirectory: fixture.repositoryPath,
            shell: false,
            outputs: [],
          },
        ],
        workflow,
        prepared.scopes,
      )[0]?.workingDirectory,
    ).toBe(prepared.scopes[0]!.worktreePath);
    await runtime.cleanup(prepared.scopes[0]!);
  });

  it('runs ordered Agents in the prepared scope and retains their final diff in history evidence', async () => {
    const fixture = await repository();
    const first = agent('first', 'codex', 'workspace-write');
    const second = agent('second', 'cline', 'workspace-write', true);
    let workflow = {
      ...createWorkflow(),
      blocks: [first, second],
      connections: [
        {
          id: 'first-to-second',
          from: { blockId: first.id, portId: 'response' },
          to: { blockId: second.id, portId: 'context' },
        },
      ],
    };
    for (const block of workflow.blocks) {
      workflow = setAgentBlockPresentation(
        workflow,
        block.id,
        block.id === first.id ? 'codex' : 'cline',
        {
          mode: 'workflow-run-worktree',
          repositoryRoot: fixture.repositoryPath,
          baseRef: 'HEAD',
          scope: 'shared',
        },
      );
    }
    const runtime = new WorktreeRuntime();
    const prepared = await prepareAgentWorktrees(workflow, {
      runId: 'run-e2e',
      storageRoot: fixture.storageRoot,
      runtime,
    });
    const workingDirectories: string[] = [];
    const runner: ProcessRunner = {
      async run(request) {
        workingDirectories.push(request.workingDirectory!);
        if (request.blockId === 'first') {
          await writeFile(
            join(request.workingDirectory!, 'tracked.txt'),
            'changed by first\n',
          );
        } else {
          expect(
            await readFile(
              join(request.workingDirectory!, 'tracked.txt'),
              'utf8',
            ),
          ).toBe('changed by first\n');
        }
        return {
          status: 'succeeded',
          exitCode: 0,
          stdout: `${request.blockId} complete`,
          stderr: '',
          artifacts: [
            {
              id: `${request.blockId}-response`,
              kind: 'text',
              value: `${request.blockId} complete`,
              provenance: {
                runId: request.runId,
                blockId: request.blockId,
                portId: 'response',
                createdAt: '2026-07-10T12:00:00.000Z',
              },
            },
          ],
        };
      },
    };
    let record: RunHistoryRecord | undefined;
    const run = startWorkflowRun(prepared.workflow, () => undefined, {
      runId: 'run-e2e',
      runner,
      onCompleted(next) {
        record = next;
      },
    });
    await run.completion;
    const worktrees = await finalizeAgentWorktrees(
      prepared.scopes,
      record!,
      runtime,
    );

    expect(new Set(workingDirectories)).toEqual(
      new Set([prepared.scopes[0]!.worktreePath]),
    );
    expect(worktrees[0]).toMatchObject({
      scopeId: 'shared',
      state: 'retained',
      reason: 'scope-changed',
      hasChangesFromBase: true,
    });
    expect(worktrees[0]!.status).toContain('tracked.txt');
  });

  it('blocks parallel write-capable Agents in one scope before creating it', async () => {
    const first = agent('first', 'codex', 'workspace-write');
    const second = agent('second', 'cline', 'workspace-write');
    let workflow = { ...createWorkflow(), blocks: [first, second] };
    for (const [block, runtime] of [
      [first, 'codex'],
      [second, 'cline'],
    ] as const) {
      workflow = setAgentBlockPresentation(workflow, block.id, runtime, {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/does/not/matter',
        baseRef: 'HEAD',
        scope: 'shared',
      });
    }

    const result = await preflightAgentWorktrees(workflow, {
      runId: 'run-parallel',
      storageRoot: '/tmp/vorkflo-tests',
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'adapter_worktree_parallel_writers',
          blockId: 'first',
        }),
      ]),
    );
    expect(result.scopes).toEqual([]);
  });

  it('leaves workflows without explicit worktree isolation unchanged', async () => {
    const workflow = { ...createWorkflow(), blocks: [agent('agent', 'codex')] };
    const prepared = await prepareAgentWorktrees(workflow, {
      runId: 'run-current-directory',
      storageRoot: '/tmp/vorkflo-tests',
    });
    expect(prepared.scopes).toEqual([]);
    expect(prepared.workflow).toEqual(workflow);
  });

  it('fails safely when saved metadata selects an unsupported Agent runtime', async () => {
    const block = agent('agent', 'codex');
    const workflow = {
      ...createWorkflow(),
      blocks: [block],
      editor: {
        'vorkflo.desktop': {
          schemaVersion: 1,
          blockPresentations: {
            agent: { kind: 'ai-agent', agentRuntime: 'future-agent' },
          },
        },
      },
    };

    const result = await preflightAgentWorktrees(workflow, {
      runId: 'run-unsupported',
      storageRoot: '/tmp/vorkflo-tests',
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'adapter_agent_runtime-unsupported',
        blockId: 'agent',
        field: 'editor.agentRuntime',
      }),
    );
  });
});

function agent(
  id: string,
  agentRuntime: AgentBlockEditorConfig['agentRuntime'],
  authority: AgentBlockEditorConfig['authority'] = 'read-only',
  withContext = false,
) {
  return compileAgentBlock({
    id,
    name: id,
    agentRuntime,
    instruction: `Run ${id}.`,
    authority,
    ...(withContext
      ? {
          textContext: { portId: 'context', name: 'Context' },
          ...(agentRuntime === 'codex'
            ? {}
            : {
                instructionDelivery: 'template' as const,
                instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
              }),
        }
      : {}),
    textResponse: { portId: 'response', name: 'Response' },
    filesystemOutputs: [],
  });
}

async function repository(): Promise<{
  repositoryPath: string;
  storageRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'vorkflo-agent-worktree-'));
  temporaryRoots.push(root);
  const repositoryPath = join(root, 'repository');
  const storageRoot = join(root, 'worktrees');
  await git(root, 'init', '-b', 'main', repositoryPath);
  await git(repositoryPath, 'config', 'user.name', 'Vorkflo Test');
  await git(repositoryPath, 'config', 'user.email', 'test@vorkflo.invalid');
  await writeFile(join(repositoryPath, 'tracked.txt'), 'base\n');
  await git(repositoryPath, 'add', 'tracked.txt');
  await git(repositoryPath, 'commit', '-m', 'base');
  return { repositoryPath, storageRoot };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}
