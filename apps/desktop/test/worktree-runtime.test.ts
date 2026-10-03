import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorktreeRuntime,
  WorktreeRuntimeError,
  type WorktreePreflightRequest,
  type WorktreeScope,
} from '../src/main/worktree-runtime';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('desktop worktree runtime', () => {
  it('resolves visible source and base metadata and creates a run-scoped branch', async () => {
    const fixture = await repository();
    await writeFile(join(fixture.repositoryPath, 'source-only.txt'), 'dirty\n');
    const runtime = fixedRuntime();

    const preflight = await runtime.preflight(request(fixture));
    expect(preflight).toMatchObject({
      repositoryRoot: fixture.repositoryPath,
      requestedBaseRef: 'HEAD',
      sourceIsDirty: true,
      runId: 'Run 42',
      scopeId: 'Shared Agents',
      branchName: 'vorkflo/run-42/shared-agents',
      worktreePath: join(fixture.storageRoot, 'run-42', 'shared-agents'),
    });
    expect(preflight.sourceStatus).toContain('source-only.txt');
    expect(preflight.baseCommit).toMatch(/^[0-9a-f]{40}$/);

    const scope = await runtime.create(preflight);
    expect(scope.createdAt).toBe('2026-07-10T12:00:00.000Z');
    expect(await git(scope.worktreePath, 'branch', '--show-current')).toBe(
      'vorkflo/run-42/shared-agents',
    );
    expect(await git(scope.worktreePath, 'rev-parse', 'HEAD')).toBe(
      scope.baseCommit,
    );
    await expect(
      fileExists(join(scope.worktreePath, 'source-only.txt')),
    ).resolves.toBe(false);
  });

  it('shares sequential changes, exposes status and diff, and refuses dirty cleanup', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();
    const scope = await createScope(runtime, fixture);

    await writeFile(
      join(scope.worktreePath, 'tracked.txt'),
      'changed by first agent\n',
    );
    await writeFile(
      join(scope.worktreePath, 'generated.txt'),
      'new agent output\n',
    );
    expect(await readFromGit(scope.worktreePath, 'tracked.txt')).toBe(
      'changed by first agent\n',
    );
    const inspection = await runtime.inspect(scope);
    expect(inspection.status).toContain(' M tracked.txt');
    expect(inspection.diff).toContain('+changed by first agent');
    expect(inspection.diff).toContain('new file (untracked)');
    expect(inspection.diff).toContain('+new agent output');
    expect(inspection.hasUncommittedChanges).toBe(true);
    expect(inspection.hasChangesFromBase).toBe(true);

    await expect(runtime.cleanup(scope)).rejects.toMatchObject({
      code: 'cleanup-changes-present',
      nextAction: expect.stringContaining('Inspect the diff'),
    });
    await expect(fileExists(scope.worktreePath)).resolves.toBe(true);
  });

  it('bounds previews of large untracked files', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();
    const scope = await createScope(runtime, fixture);
    await writeFile(
      join(scope.worktreePath, 'large-output.txt'),
      `${'agent output\n'.repeat(24_000)}must-not-be-read`,
    );

    const inspection = await runtime.inspect(scope);
    expect(inspection.diff).toContain('file preview truncated');
    expect(inspection.diff).not.toContain('must-not-be-read');
  });

  it('retains committed changes even when porcelain status is clean', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();
    const scope = await createScope(runtime, fixture);
    await writeFile(
      join(scope.worktreePath, 'tracked.txt'),
      'committed change\n',
    );
    await git(scope.worktreePath, 'add', 'tracked.txt');
    await git(scope.worktreePath, 'commit', '-m', 'agent change');

    const inspection = await runtime.inspect(scope);
    expect(inspection.status).toBe('');
    expect(inspection.hasUncommittedChanges).toBe(false);
    expect(inspection.hasChangesFromBase).toBe(true);
    await expect(runtime.cleanup(scope)).rejects.toMatchObject({
      code: 'cleanup-changes-present',
    });
  });

  it('retains failed runs and allows successful unchanged scopes to clean up', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();
    const failedScope = await createScope(runtime, fixture, 'failed-scope');

    await expect(
      runtime.evaluateDisposition(failedScope, 'failed', 'cleanup-when-safe'),
    ).resolves.toMatchObject({ state: 'retained', reason: 'run-failed' });

    const cleanScope = await createScope(runtime, fixture, 'clean-scope');
    await expect(
      runtime.evaluateDisposition(cleanScope, 'succeeded', 'cleanup-when-safe'),
    ).resolves.toMatchObject({
      state: 'eligible-for-cleanup',
      reason: 'safe-to-clean',
    });
    await runtime.cleanup(cleanScope);
    await expect(fileExists(cleanScope.worktreePath)).resolves.toBe(false);
    await expect(
      git(
        fixture.repositoryPath,
        'show-ref',
        '--verify',
        cleanScope.branchName,
      ),
    ).rejects.toBeDefined();
  });

  it('cleans an unchanged scope whose selected base is not merged into the current branch', async () => {
    const fixture = await repository();
    await git(fixture.repositoryPath, 'checkout', '-b', 'alternate-base');
    await writeFile(join(fixture.repositoryPath, 'alternate.txt'), 'base\n');
    await git(fixture.repositoryPath, 'add', 'alternate.txt');
    await git(fixture.repositoryPath, 'commit', '-m', 'alternate base');
    await git(fixture.repositoryPath, 'checkout', 'main');
    const runtime = fixedRuntime();
    const scope = await runtime.create(
      await runtime.preflight({
        ...request(fixture),
        baseRef: 'alternate-base',
        scopeId: 'alternate-clean',
      }),
    );

    await runtime.cleanup(scope);
    await expect(fileExists(scope.worktreePath)).resolves.toBe(false);
    await expect(
      git(
        fixture.repositoryPath,
        'show-ref',
        '--verify',
        `refs/heads/${scope.branchName}`,
      ),
    ).rejects.toBeDefined();
  });

  it('refuses cleanup while active runs or retained artifacts depend on the scope', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();
    const activeScope = await createScope(runtime, fixture, 'active-scope');
    await expect(
      runtime.cleanup(activeScope, { activeRunIds: ['dependent-run'] }),
    ).rejects.toMatchObject({ code: 'cleanup-active-dependency' });

    const artifactScope = await createScope(runtime, fixture, 'artifact-scope');
    await expect(
      runtime.cleanup(artifactScope, {
        retainedArtifactPaths: [
          join(artifactScope.worktreePath, 'tracked.txt'),
        ],
      }),
    ).rejects.toMatchObject({ code: 'cleanup-artifact-dependency' });
  });

  it('reports invalid repositories, base refs, path conflicts, and parallel writers actionably', async () => {
    const fixture = await repository();
    const runtime = fixedRuntime();

    await expect(
      runtime.preflight({
        ...request(fixture),
        repositoryPath: fixture.storageRoot,
      }),
    ).rejects.toMatchObject({
      code: 'repository-invalid',
      nextAction: expect.stringContaining('Git repository'),
    });
    await expect(
      runtime.preflight({ ...request(fixture), baseRef: 'missing-base' }),
    ).rejects.toMatchObject({ code: 'base-ref-invalid' });
    await expect(
      runtime.preflight({
        ...request(fixture),
        participants: [
          { blockId: 'writer-a', mayWrite: true, concurrencyGroup: 'parallel' },
          { blockId: 'writer-b', mayWrite: true, concurrencyGroup: 'parallel' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'parallel-writers-conflict',
      nextAction: expect.stringContaining('separate explicit isolation scopes'),
    });

    const scope = await createScope(runtime, fixture, 'collision');
    await expect(
      runtime.preflight({ ...request(fixture), scopeId: 'collision' }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof WorktreeRuntimeError &&
        (error.code === 'branch-conflict' ||
          error.code === 'worktree-path-conflict'),
    );
    expect(scope.branchName).toBe('vorkflo/run-42/collision');
  });
});

function fixedRuntime(): WorktreeRuntime {
  return new WorktreeRuntime({ now: () => new Date('2026-07-10T12:00:00Z') });
}

async function repository(): Promise<{
  repositoryPath: string;
  storageRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'vorkflo-worktree-test-'));
  temporaryRoots.push(root);
  const repositoryPath = join(root, 'repository');
  const storageRoot = join(root, 'worktrees');
  await git(root, 'init', '-b', 'main', repositoryPath);
  await git(repositoryPath, 'config', 'user.name', 'Vorkflo Test');
  await git(repositoryPath, 'config', 'user.email', 'test@vorkflo.invalid');
  await writeFile(join(repositoryPath, 'tracked.txt'), 'base\n');
  await git(repositoryPath, 'add', 'tracked.txt');
  await git(repositoryPath, 'commit', '-m', 'base');
  return { repositoryPath: await realpath(repositoryPath), storageRoot };
}

function request(fixture: {
  repositoryPath: string;
  storageRoot: string;
}): WorktreePreflightRequest {
  return {
    ...fixture,
    baseRef: 'HEAD',
    runId: 'Run 42',
    scopeId: 'Shared Agents',
    participants: [
      { blockId: 'agent-a', mayWrite: true },
      { blockId: 'agent-b', mayWrite: true },
    ],
  };
}

async function createScope(
  runtime: WorktreeRuntime,
  fixture: { repositoryPath: string; storageRoot: string },
  scopeId = 'Shared Agents',
): Promise<WorktreeScope> {
  return runtime.create(
    await runtime.preflight({ ...request(fixture), scopeId }),
  );
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
  });
  return result.stdout.trim();
}

async function readFromGit(cwd: string, path: string): Promise<string> {
  return readFile(join(cwd, path), 'utf8');
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
