import { isAbsolute, resolve } from 'node:path';
import {
  resolveWorkflowRunInputValues,
  type WorkflowRunInputs,
  type BlockPreflightPreview,
  type PreflightIssue,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import {
  alignAgentRuntimeWorkingDirectories,
  agentEditorConfigFromBlock,
  getAgentBlockMetadataIssue,
  getAgentBlockPresentation,
  type AgentIsolationConfig,
} from '../shared/agent-runtime.js';
import type {
  RunHistoryRecord,
  WorktreeRunRecord,
} from '../shared/contracts.js';
import {
  WorktreeRuntime,
  WorktreeRuntimeError,
  type WorktreePreflight,
  type WorktreeScope,
} from './worktree-runtime.js';

export interface AgentWorktreeOptions {
  readonly runId: string;
  readonly storageRoot: string;
  readonly baseDirectory?: string;
  readonly runtime?: WorktreeRuntime;
  readonly runInputs?: WorkflowRunInputs;
}

export interface AgentWorktreePreflightResult {
  readonly issues: readonly PreflightIssue[];
  readonly scopes: readonly WorktreePreflight[];
}

export interface PreparedAgentWorktrees {
  readonly workflow: WorkflowDefinition;
  readonly scopes: readonly WorktreeScope[];
}

export function applyAgentWorktreePreviews(
  blocks: readonly BlockPreflightPreview[],
  workflow: WorkflowDefinition,
  scopes: readonly WorktreePreflight[],
): readonly BlockPreflightPreview[] {
  const scopesById = new Map(scopes.map((scope) => [scope.scopeId, scope]));
  return blocks.map((preview) => {
    const presentation = getAgentBlockPresentation(workflow, preview.blockId);
    if (presentation?.isolation?.mode !== 'workflow-run-worktree') {
      return preview;
    }
    const scope = scopesById.get(presentation.isolation.scope);
    const block = workflow.blocks.find(
      (candidate) => candidate.id === preview.blockId,
    );
    if (scope === undefined || block === undefined) return preview;
    const declaredOutputs = new Map(
      block.invocation.outputs.flatMap((output) =>
        output.type === 'filesystem' ? [[output.portId, output] as const] : [],
      ),
    );
    return {
      ...preview,
      workingDirectory: scope.worktreePath,
      outputs: preview.outputs.map((output) => {
        const declared = declaredOutputs.get(output.portId);
        if (declared === undefined) return output;
        return {
          ...output,
          path: isAbsolute(declared.path)
            ? resolve(declared.path)
            : resolve(scope.worktreePath, declared.path),
        };
      }),
    };
  });
}

interface ScopePlan {
  readonly isolation: Extract<
    AgentIsolationConfig,
    { readonly mode: 'workflow-run-worktree' }
  >;
  readonly blocks: readonly {
    readonly blockId: string;
    readonly mayWrite: boolean;
  }[];
}

/**
 * Validates explicit Agent worktree scopes without creating a branch or path.
 * The desktop host owns this preparation; the engine continues to receive only
 * generic process working directories.
 */
export async function preflightAgentWorktrees(
  workflow: WorkflowDefinition,
  options: AgentWorktreeOptions,
): Promise<AgentWorktreePreflightResult> {
  const runtime = options.runtime ?? new WorktreeRuntime();
  const collected = collectScopePlans(workflow, options.baseDirectory);
  const issues = [
    ...workflow.blocks.flatMap((block) => {
      const issue = getAgentBlockMetadataIssue(workflow, block.id);
      return issue === undefined
        ? []
        : [
            blockIssue(
              block.id,
              `adapter_agent_${issue.code}`,
              issue.message,
              issue.field,
            ),
          ];
    }),
    ...collected.issues,
  ];
  const scopes: WorktreePreflight[] = [];

  for (const plan of collected.plans) {
    const parallelWriters = findParallelWriters(workflow, plan);
    if (parallelWriters !== undefined) {
      issues.push(
        ...parallelWriters.map((blockId) =>
          blockIssue(
            blockId,
            'adapter_worktree_parallel_writers',
            `Write-capable blocks ${parallelWriters.join(', ')} can run concurrently in shared worktree scope ${plan.isolation.scope}.`,
            'editor.isolation.scope',
          ),
        ),
      );
      continue;
    }

    try {
      const scope = await runtime.preflight({
        repositoryPath: resolveRepositoryPath(
          plan.isolation.repositoryRoot,
          options.baseDirectory,
        ),
        baseRef: plan.isolation.baseRef,
        runId: options.runId,
        scopeId: plan.isolation.scope,
        storageRoot: options.storageRoot,
        participants: plan.blocks.map((participant) => ({
          blockId: participant.blockId,
          mayWrite: participant.mayWrite,
        })),
      });
      scopes.push(scope);
      issues.push(
        ...plan.blocks.map((participant) =>
          blockIssue(
            participant.blockId,
            'adapter_worktree_scope_resolved',
            `Worktree scope ${scope.scopeId} will use base commit ${scope.baseCommit} at ${scope.worktreePath}.${scope.sourceIsDirty ? ' The source worktree is dirty; its uncommitted changes will not be copied.' : ' The source worktree is clean.'}`,
            'editor.isolation',
            'warning',
          ),
        ),
      );
    } catch (error) {
      const worktreeError = normalizeWorktreeError(error);
      issues.push(
        ...plan.blocks.map((participant) =>
          blockIssue(
            participant.blockId,
            `adapter_worktree_${worktreeError.code}`,
            `${worktreeError.message} ${worktreeError.nextAction}`,
            'editor.isolation',
          ),
        ),
      );
    }
  }

  return { issues, scopes };
}

/** Creates every validated scope and rewrites participating generic blocks. */
export async function prepareAgentWorktrees(
  workflow: WorkflowDefinition,
  options: AgentWorktreeOptions,
): Promise<PreparedAgentWorktrees> {
  // Reject invalid inputs before creating run-owned branches or directories.
  resolveWorkflowRunInputValues(workflow, options.runInputs ?? {});
  const runtime = options.runtime ?? new WorktreeRuntime();
  const preflight = await preflightAgentWorktrees(workflow, {
    ...options,
    runtime,
  });
  const blocker = preflight.issues.find(
    (issue) => issue.severity === 'blocker',
  );
  if (blocker !== undefined) {
    throw new WorktreeRuntimeError(
      'scope-invalid',
      blocker.message,
      'Resolve the worktree preflight issue and retry the workflow.',
    );
  }

  const created: WorktreeScope[] = [];
  try {
    for (const candidate of preflight.scopes) {
      created.push(await runtime.create(candidate));
    }
  } catch (error) {
    await Promise.allSettled(created.map((scope) => runtime.cleanup(scope)));
    throw error;
  }

  const pathsByScope = new Map(
    created.map((scope) => [scope.scopeId, scope.worktreePath] as const),
  );
  return {
    workflow: alignAgentRuntimeWorkingDirectories({
      ...workflow,
      blocks: workflow.blocks.map((block) => {
        const presentation = getAgentBlockPresentation(workflow, block.id);
        if (presentation?.isolation?.mode !== 'workflow-run-worktree') {
          return block;
        }
        const worktreePath = pathsByScope.get(presentation.isolation.scope);
        if (worktreePath === undefined) return block;
        return {
          ...block,
          invocation: {
            ...block.invocation,
            workingDirectory: worktreePath,
          },
        };
      }),
    }),
    scopes: created,
  };
}

export async function finalizeAgentWorktrees(
  scopes: readonly WorktreeScope[],
  record: RunHistoryRecord,
  runtime: WorktreeRuntime,
): Promise<readonly WorktreeRunRecord[]> {
  const retainedArtifactPaths = record.blocks.flatMap((block) =>
    block.artifacts.flatMap((artifact) =>
      artifact.kind === 'filesystem-reference' ? [artifact.path] : [],
    ),
  );
  return Promise.all(
    scopes.map(async (scope): Promise<WorktreeRunRecord> => {
      try {
        const disposition = await runtime.evaluateDisposition(
          scope,
          record.outcome,
          'cleanup-when-safe',
          { retainedArtifactPaths },
        );
        const shouldClean = disposition.state === 'eligible-for-cleanup';
        if (shouldClean) {
          await runtime.cleanup(scope, { retainedArtifactPaths });
        }
        return {
          scopeId: scope.scopeId,
          repositoryRoot: scope.repositoryRoot,
          baseCommit: scope.baseCommit,
          branchName: scope.branchName,
          worktreePath: scope.worktreePath,
          createdAt: scope.createdAt,
          sourceIsDirty: scope.sourceIsDirty,
          state: shouldClean ? 'cleaned' : 'retained',
          reason: disposition.reason,
          status: disposition.inspection.status,
          headCommit: disposition.inspection.headCommit,
          hasChangesFromBase: disposition.inspection.hasChangesFromBase,
          nextAction: disposition.nextAction,
        };
      } catch (error) {
        return {
          scopeId: scope.scopeId,
          repositoryRoot: scope.repositoryRoot,
          baseCommit: scope.baseCommit,
          branchName: scope.branchName,
          worktreePath: scope.worktreePath,
          createdAt: scope.createdAt,
          sourceIsDirty: scope.sourceIsDirty,
          state: 'retained',
          reason: 'inspection-failed',
          status: '',
          headCommit: scope.baseCommit,
          hasChangesFromBase: true,
          nextAction:
            error instanceof WorktreeRuntimeError
              ? error.nextAction
              : 'Reveal and inspect the retained worktree before handling it manually.',
        };
      }
    }),
  );
}

function collectScopePlans(
  workflow: WorkflowDefinition,
  baseDirectory: string | undefined,
): {
  readonly plans: readonly ScopePlan[];
  readonly issues: readonly PreflightIssue[];
} {
  const grouped = new Map<string, ScopePlan>();
  const issues: PreflightIssue[] = [];
  for (const block of workflow.blocks) {
    const presentation = getAgentBlockPresentation(workflow, block.id);
    if (presentation?.isolation?.mode !== 'workflow-run-worktree') continue;
    const isolation = presentation.isolation;
    const existing = grouped.get(isolation.scope);
    if (
      existing !== undefined &&
      (resolveRepositoryPath(
        existing.isolation.repositoryRoot,
        baseDirectory,
      ) !== resolveRepositoryPath(isolation.repositoryRoot, baseDirectory) ||
        existing.isolation.baseRef !== isolation.baseRef)
    ) {
      issues.push(
        blockIssue(
          block.id,
          'adapter_worktree_scope_mismatch',
          `Shared worktree scope ${isolation.scope} uses conflicting repository roots or base refs.`,
          'editor.isolation.scope',
        ),
      );
      continue;
    }
    const mayWrite =
      agentEditorConfigFromBlock(block, presentation).authority ===
      'workspace-write';
    grouped.set(isolation.scope, {
      isolation,
      blocks: [...(existing?.blocks ?? []), { blockId: block.id, mayWrite }],
    });
  }
  return { plans: [...grouped.values()], issues };
}

function resolveRepositoryPath(
  repositoryRoot: string,
  baseDirectory: string | undefined,
): string {
  if (baseDirectory === undefined) return repositoryRoot;
  return resolve(baseDirectory, repositoryRoot.trim() || '.');
}

function findParallelWriters(
  workflow: WorkflowDefinition,
  plan: ScopePlan,
): readonly string[] | undefined {
  const writers = plan.blocks.filter((block) => block.mayWrite);
  for (let leftIndex = 0; leftIndex < writers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < writers.length;
      rightIndex += 1
    ) {
      const left = writers[leftIndex]!;
      const right = writers[rightIndex]!;
      if (
        !hasPath(workflow, left.blockId, right.blockId) &&
        !hasPath(workflow, right.blockId, left.blockId)
      ) {
        return [left.blockId, right.blockId];
      }
    }
  }
  return undefined;
}

function hasPath(
  workflow: WorkflowDefinition,
  sourceId: string,
  targetId: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const connection of workflow.connections) {
    outgoing.set(connection.from.blockId, [
      ...(outgoing.get(connection.from.blockId) ?? []),
      connection.to.blockId,
    ]);
  }
  const pending = [...(outgoing.get(sourceId) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (next === targetId) return true;
    if (visited.has(next)) continue;
    visited.add(next);
    pending.push(...(outgoing.get(next) ?? []));
  }
  return false;
}

function blockIssue(
  blockId: string,
  code: `adapter_${string}`,
  message: string,
  field: string,
  severity: PreflightIssue['severity'] = 'blocker',
): PreflightIssue {
  return {
    severity,
    code,
    message,
    path: `blocks.${blockId}.${field}`,
    field,
    blockId,
  };
}

function normalizeWorktreeError(error: unknown): WorktreeRuntimeError {
  return error instanceof WorktreeRuntimeError
    ? error
    : new WorktreeRuntimeError(
        'scope-invalid',
        error instanceof Error ? error.message : String(error),
        'Inspect the worktree isolation configuration and retry.',
      );
}
