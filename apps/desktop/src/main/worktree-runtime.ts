import { execFile } from 'node:child_process';
import { access, mkdir, open, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WorktreeRunOutcome = 'succeeded' | 'failed' | 'cancelled';
export type WorktreeRetentionPolicy = 'retain' | 'cleanup-when-safe';

export interface WorktreeParticipant {
  readonly blockId: string;
  readonly mayWrite: boolean;
  /** Blocks with the same non-empty group may execute concurrently. */
  readonly concurrencyGroup?: string;
}

export interface WorktreePreflightRequest {
  readonly repositoryPath: string;
  readonly baseRef: string;
  readonly runId: string;
  readonly scopeId: string;
  readonly storageRoot: string;
  readonly participants?: readonly WorktreeParticipant[];
}

export interface WorktreePreflight {
  readonly repositoryRoot: string;
  readonly requestedBaseRef: string;
  readonly baseCommit: string;
  readonly sourceStatus: string;
  readonly sourceIsDirty: boolean;
  readonly runId: string;
  readonly scopeId: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly participants: readonly WorktreeParticipant[];
}

export interface WorktreeScope extends WorktreePreflight {
  readonly createdAt: string;
}

export interface WorktreeInspection {
  readonly status: string;
  readonly diff: string;
  readonly headCommit: string;
  readonly hasUncommittedChanges: boolean;
  readonly hasChangesFromBase: boolean;
}

export interface WorktreeDependencies {
  readonly activeRunIds?: readonly string[];
  readonly retainedArtifactPaths?: readonly string[];
}

export interface WorktreeDisposition {
  readonly state: 'retained' | 'eligible-for-cleanup';
  readonly reason:
    | 'retention-policy'
    | 'run-failed'
    | 'run-cancelled'
    | 'scope-changed'
    | 'active-run-dependency'
    | 'retained-artifact-dependency'
    | 'safe-to-clean';
  readonly nextAction: string;
  readonly inspection: WorktreeInspection;
}

export type WorktreeFailureCode =
  | 'git-unavailable'
  | 'repository-invalid'
  | 'base-ref-invalid'
  | 'scope-invalid'
  | 'parallel-writers-conflict'
  | 'branch-conflict'
  | 'worktree-path-conflict'
  | 'worktree-create-failed'
  | 'worktree-inspection-failed'
  | 'cleanup-changes-present'
  | 'cleanup-active-dependency'
  | 'cleanup-artifact-dependency'
  | 'cleanup-failed';

export class WorktreeRuntimeError extends Error {
  readonly code: WorktreeFailureCode;
  readonly nextAction: string;
  readonly detail: string | undefined;

  constructor(
    code: WorktreeFailureCode,
    message: string,
    nextAction: string,
    detail?: string,
  ) {
    super(message);
    this.name = 'WorktreeRuntimeError';
    this.code = code;
    this.nextAction = nextAction;
    this.detail = detail;
  }
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd?: string): Promise<GitResult>;
}

class LocalGitCommandRunner implements GitCommandRunner {
  async run(args: readonly string[], cwd?: string): Promise<GitResult> {
    try {
      const result = await execFileAsync('git', args, {
        ...(cwd === undefined ? {} : { cwd }),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new WorktreeRuntimeError(
          'git-unavailable',
          'Git is required to create an isolated workflow-run worktree.',
          'Install Git and make it available on the desktop application PATH.',
        );
      }
      throw error;
    }
  }
}

/** Desktop-host lifecycle for explicit, run-scoped Git worktrees. */
export class WorktreeRuntime {
  readonly #git: GitCommandRunner;
  readonly #now: () => Date;

  constructor(options: { git?: GitCommandRunner; now?: () => Date } = {}) {
    this.#git = options.git ?? new LocalGitCommandRunner();
    this.#now = options.now ?? (() => new Date());
  }

  async preflight(
    request: WorktreePreflightRequest,
  ): Promise<WorktreePreflight> {
    validateRequest(request);
    validateParticipants(request.participants ?? []);

    let repositoryRoot: string;
    try {
      repositoryRoot = cleanLine(
        (
          await this.#git.run([
            '-C',
            request.repositoryPath,
            'rev-parse',
            '--show-toplevel',
          ])
        ).stdout,
      );
    } catch (error) {
      rethrowKnown(error);
      throw failure(
        'repository-invalid',
        `The selected path is not an accessible Git worktree: ${request.repositoryPath}`,
        'Choose a directory inside a local Git repository.',
        error,
      );
    }

    let baseCommit: string;
    try {
      baseCommit = cleanLine(
        (
          await this.#git.run([
            '-C',
            repositoryRoot,
            'rev-parse',
            '--verify',
            `${request.baseRef}^{commit}`,
          ])
        ).stdout,
      );
    } catch (error) {
      rethrowKnown(error);
      throw failure(
        'base-ref-invalid',
        `Git could not resolve the selected base ref: ${request.baseRef}`,
        'Choose a visible branch, tag, or commit that exists in the repository.',
        error,
      );
    }

    const branchName = `vorkflo/${safeToken(request.runId)}/${safeToken(request.scopeId)}`;
    const worktreePath = resolve(
      request.storageRoot,
      safeToken(request.runId),
      safeToken(request.scopeId),
    );
    await ensureBranchAvailable(this.#git, repositoryRoot, branchName);
    await ensurePathAvailable(worktreePath);
    const sourceStatus = (
      await this.#git.run([
        '-C',
        repositoryRoot,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ])
    ).stdout.trimEnd();

    return {
      repositoryRoot,
      requestedBaseRef: request.baseRef,
      baseCommit,
      sourceStatus,
      sourceIsDirty: sourceStatus.length > 0,
      runId: request.runId,
      scopeId: request.scopeId,
      branchName,
      worktreePath,
      participants: [...(request.participants ?? [])],
    };
  }

  async create(preflight: WorktreePreflight): Promise<WorktreeScope> {
    await ensureBranchAvailable(
      this.#git,
      preflight.repositoryRoot,
      preflight.branchName,
    );
    await ensurePathAvailable(preflight.worktreePath);
    await mkdir(resolve(preflight.worktreePath, '..'), { recursive: true });
    try {
      await this.#git.run([
        '-C',
        preflight.repositoryRoot,
        'worktree',
        'add',
        '-b',
        preflight.branchName,
        preflight.worktreePath,
        preflight.baseCommit,
      ]);
    } catch (error) {
      rethrowKnown(error);
      throw failure(
        'worktree-create-failed',
        `Git could not create the workflow-run worktree at ${preflight.worktreePath}.`,
        'Inspect the repository worktree list, resolve the reported conflict, and retry.',
        error,
      );
    }
    return { ...preflight, createdAt: this.#now().toISOString() };
  }

  async inspect(scope: WorktreeScope): Promise<WorktreeInspection> {
    try {
      const [status, diff, head, untracked] = await Promise.all([
        this.#git.run([
          '-C',
          scope.worktreePath,
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
        ]),
        this.#git.run([
          '-C',
          scope.worktreePath,
          'diff',
          '--no-ext-diff',
          '--binary',
          scope.baseCommit,
          '--',
        ]),
        this.#git.run(['-C', scope.worktreePath, 'rev-parse', 'HEAD']),
        this.#git.run([
          '-C',
          scope.worktreePath,
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      ]);
      const normalizedStatus = status.stdout.trimEnd();
      const headCommit = cleanLine(head.stdout);
      const untrackedDiff = await renderUntrackedFiles(
        scope.worktreePath,
        untracked.stdout,
      );
      return {
        status: normalizedStatus,
        diff: [diff.stdout.trimEnd(), untrackedDiff]
          .filter((part) => part.length > 0)
          .join('\n'),
        headCommit,
        hasUncommittedChanges: normalizedStatus.length > 0,
        hasChangesFromBase:
          normalizedStatus.length > 0 || headCommit !== scope.baseCommit,
      };
    } catch (error) {
      rethrowKnown(error);
      throw failure(
        'worktree-inspection-failed',
        `Git could not inspect the workflow-run worktree at ${scope.worktreePath}.`,
        'Reveal the retained path and inspect or repair the worktree with Git.',
        error,
      );
    }
  }

  async evaluateDisposition(
    scope: WorktreeScope,
    outcome: WorktreeRunOutcome,
    policy: WorktreeRetentionPolicy,
    dependencies: WorktreeDependencies = {},
  ): Promise<WorktreeDisposition> {
    const inspection = await this.inspect(scope);
    const reason = dispositionReason(
      scope,
      outcome,
      policy,
      dependencies,
      inspection,
    );
    return {
      state: reason === 'safe-to-clean' ? 'eligible-for-cleanup' : 'retained',
      reason,
      nextAction: dispositionNextAction(reason),
      inspection,
    };
  }

  async cleanup(
    scope: WorktreeScope,
    dependencies: WorktreeDependencies = {},
  ): Promise<void> {
    const inspection = await this.inspect(scope);
    if (inspection.hasChangesFromBase) {
      throw new WorktreeRuntimeError(
        'cleanup-changes-present',
        'The workflow-run worktree differs from its base commit and was retained.',
        'Inspect the diff and preserve or discard the changes explicitly outside automatic cleanup.',
      );
    }
    if ((dependencies.activeRunIds?.length ?? 0) > 0) {
      throw new WorktreeRuntimeError(
        'cleanup-active-dependency',
        'Another active run still depends on this workflow-run worktree.',
        'Wait for the dependent run to finish before retrying cleanup.',
      );
    }
    if (
      artifactDependsOnScope(scope, dependencies.retainedArtifactPaths ?? [])
    ) {
      throw new WorktreeRuntimeError(
        'cleanup-artifact-dependency',
        'A retained filesystem artifact still depends on this workflow-run worktree.',
        'Retain the worktree or move and rebind the artifact before cleanup.',
      );
    }
    try {
      await this.#git.run([
        '-C',
        scope.repositoryRoot,
        'worktree',
        'remove',
        scope.worktreePath,
      ]);
      await this.#git.run([
        '-C',
        scope.repositoryRoot,
        'branch',
        '-D',
        scope.branchName,
      ]);
    } catch (error) {
      rethrowKnown(error);
      throw failure(
        'cleanup-failed',
        `Git could not safely remove the workflow-run worktree at ${scope.worktreePath}.`,
        'Inspect git worktree list and remove the clean scope manually if it is no longer needed.',
        error,
      );
    }
  }
}

async function renderUntrackedFiles(
  worktreePath: string,
  serializedPaths: string,
): Promise<string> {
  const paths = serializedPaths.split('\0').filter((path) => path.length > 0);
  const rendered: string[] = [];
  let remainingBytes = 1024 * 1024;
  for (const path of paths) {
    if (remainingBytes <= 0) {
      rendered.push('Untracked file preview truncated after 1 MiB.');
      break;
    }
    const absolutePath = resolve(worktreePath, path);
    const child = relative(resolve(worktreePath), absolutePath);
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
      continue;
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) continue;
      const limit = Math.min(metadata.size, remainingBytes, 256 * 1024);
      const handle = await open(absolutePath, 'r');
      let content: Buffer;
      try {
        const preview = Buffer.allocUnsafe(limit);
        const { bytesRead } = await handle.read(preview, 0, limit, 0);
        content = preview.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      remainingBytes -= content.byteLength;
      if (content.includes(0)) {
        rendered.push(
          `diff --git a/${path} b/${path}\nBinary untracked file ${path}`,
        );
        continue;
      }
      const text = content.toString('utf8');
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      rendered.push(
        [
          `diff --git a/${path} b/${path}`,
          'new file (untracked)',
          '--- /dev/null',
          `+++ b/${path}`,
          '@@',
          ...lines.map((line) => `+${line}`),
          ...(metadata.size > limit ? ['+… file preview truncated …'] : []),
        ].join('\n'),
      );
    } catch {
      rendered.push(`Untracked file ${path} could not be previewed.`);
    }
  }
  return rendered.join('\n');
}

function validateRequest(request: WorktreePreflightRequest): void {
  if (
    !isAbsolute(request.repositoryPath) ||
    !isAbsolute(request.storageRoot) ||
    request.baseRef.trim().length === 0 ||
    request.runId.trim().length === 0 ||
    request.scopeId.trim().length === 0
  ) {
    throw new WorktreeRuntimeError(
      'scope-invalid',
      'Worktree isolation requires absolute repository and storage paths plus non-empty base, run, and scope identifiers.',
      'Review the isolation configuration and supply every visible scope field.',
    );
  }
}

function validateParticipants(
  participants: readonly WorktreeParticipant[],
): void {
  const writersByGroup = new Map<string, string[]>();
  for (const participant of participants) {
    if (!participant.mayWrite || participant.concurrencyGroup === undefined)
      continue;
    const group = participant.concurrencyGroup.trim();
    if (group.length === 0) continue;
    writersByGroup.set(group, [
      ...(writersByGroup.get(group) ?? []),
      participant.blockId,
    ]);
  }
  const conflict = [...writersByGroup.entries()].find(
    ([, blocks]) => blocks.length > 1,
  );
  if (conflict !== undefined) {
    throw new WorktreeRuntimeError(
      'parallel-writers-conflict',
      `Write-capable blocks ${conflict[1].join(', ')} may run concurrently in shared scope group ${conflict[0]}.`,
      'Order these blocks in the DAG or assign separate explicit isolation scopes.',
    );
  }
}

async function ensureBranchAvailable(
  git: GitCommandRunner,
  repositoryRoot: string,
  branchName: string,
): Promise<void> {
  try {
    await git.run([
      '-C',
      repositoryRoot,
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ]);
  } catch (error) {
    rethrowKnown(error);
    return;
  }
  throw new WorktreeRuntimeError(
    'branch-conflict',
    `The workflow-run branch already exists: ${branchName}`,
    'Use a new run or scope identifier, or inspect and remove the existing retained scope.',
  );
}

async function ensurePathAvailable(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new WorktreeRuntimeError(
    'worktree-path-conflict',
    `The workflow-run worktree path already exists: ${path}`,
    'Use a new run or scope identifier, or inspect the existing retained path.',
  );
}

function dispositionReason(
  scope: WorktreeScope,
  outcome: WorktreeRunOutcome,
  policy: WorktreeRetentionPolicy,
  dependencies: WorktreeDependencies,
  inspection: WorktreeInspection,
): WorktreeDisposition['reason'] {
  if (outcome === 'failed') return 'run-failed';
  if (outcome === 'cancelled') return 'run-cancelled';
  if (inspection.hasChangesFromBase) return 'scope-changed';
  if ((dependencies.activeRunIds?.length ?? 0) > 0)
    return 'active-run-dependency';
  if (artifactDependsOnScope(scope, dependencies.retainedArtifactPaths ?? [])) {
    return 'retained-artifact-dependency';
  }
  return policy === 'retain' ? 'retention-policy' : 'safe-to-clean';
}

function dispositionNextAction(reason: WorktreeDisposition['reason']): string {
  switch (reason) {
    case 'safe-to-clean':
      return 'The scope is unchanged and may be removed with safe cleanup.';
    case 'scope-changed':
      return 'Inspect the diff and retain it until the changes are handled explicitly.';
    case 'run-failed':
    case 'run-cancelled':
      return 'Inspect the retained scope and run evidence before deciding what to do with it.';
    case 'active-run-dependency':
      return 'Wait for every dependent run to finish before cleanup.';
    case 'retained-artifact-dependency':
      return 'Move and rebind the retained artifact, or keep the scope.';
    case 'retention-policy':
      return 'Change the retention choice explicitly when the clean scope is no longer needed.';
  }
}

function artifactDependsOnScope(
  scope: WorktreeScope,
  artifactPaths: readonly string[],
): boolean {
  const root = resolve(scope.worktreePath);
  return artifactPaths.some((path) => {
    if (!isAbsolute(path)) return false;
    const child = relative(root, resolve(path));
    return (
      child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
    );
  });
}

function safeToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  if (token.length === 0) {
    throw new WorktreeRuntimeError(
      'scope-invalid',
      `The identifier ${JSON.stringify(value)} cannot form a safe worktree name.`,
      'Use identifiers containing letters, numbers, dots, underscores, or hyphens.',
    );
  }
  return token;
}

function cleanLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? '';
}

function failure(
  code: WorktreeFailureCode,
  message: string,
  nextAction: string,
  error: unknown,
): WorktreeRuntimeError {
  return new WorktreeRuntimeError(
    code,
    message,
    nextAction,
    commandDetail(error),
  );
}

function commandDetail(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { stderr?: unknown; message?: unknown };
  if (
    typeof candidate.stderr === 'string' &&
    candidate.stderr.trim().length > 0
  ) {
    return candidate.stderr.trim();
  }
  return typeof candidate.message === 'string' ? candidate.message : undefined;
}

function isCommandNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function rethrowKnown(error: unknown): void {
  if (error instanceof WorktreeRuntimeError) throw error;
}
