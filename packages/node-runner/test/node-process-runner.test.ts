import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ProcessRunner, ProcessRunRequest } from '@vorkflo/engine';

import { NodeProcessRunner } from '../src/index.js';

const runner = new NodeProcessRunner({
  now: () => new Date('2026-07-09T12:00:00.000Z'),
  terminationGracePeriodMs: 100,
});

test('implements the engine ProcessRunner contract', () => {
  const compatible: ProcessRunner = runner;
  assert.equal(compatible, runner);
});

test('runs Node directly with controlled cwd, environment, stdin, and output capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
  try {
    const canonicalDirectory = await realpath(directory);
    const request = nodeRequest(
      `
        let stdin = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => stdin += chunk);
        process.stdin.on('end', () => {
          process.stdout.write(JSON.stringify({
            cwd: process.cwd(),
            visible: process.env.VISIBLE_VALUE,
            hidden: process.env.AMBIENT_ONLY,
            stdin
          }));
          process.stderr.write('diagnostic');
        });
      `,
      {
        workingDirectory: directory,
        environment: { VISIBLE_VALUE: 'yes' },
        stdin: 'input text',
        outputs: [
          { portId: 'data', kind: 'json', source: 'stdout' },
          { portId: 'log', kind: 'text', source: 'stderr' },
        ],
      },
    );

    const result = await runner.run(request, unaborted());

    assert.equal(result.status, 'succeeded');
    assert.equal(result.stderr, 'diagnostic');
    assert.deepEqual(result.artifacts, [
      {
        id: '["run-1","block-1","data"]',
        kind: 'json',
        provenance: {
          runId: 'run-1',
          blockId: 'block-1',
          portId: 'data',
          createdAt: '2026-07-09T12:00:00.000Z',
        },
        value: {
          cwd: canonicalDirectory,
          visible: 'yes',
          stdin: 'input text',
        },
      },
      {
        id: '["run-1","block-1","log"]',
        kind: 'text',
        provenance: {
          runId: 'run-1',
          blockId: 'block-1',
          portId: 'log',
          createdAt: '2026-07-09T12:00:00.000Z',
        },
        value: 'diagnostic',
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid environment names instead of silently dropping them', async () => {
  for (const name of ['A=B', '__proto__', 'constructor', 'prototype']) {
    const environment = Object.create(null) as Record<string, string>;
    environment[name] = 'hidden';
    const result = await runner.run(
      nodeRequest('process.stdout.write("must not run")', { environment }),
      unaborted(),
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.stdout, '');
    if (result.status === 'failed') {
      assert.equal(result.failure.code, 'process_launch_failed');
      assert.match(result.failure.message, /Environment variable name/);
    }
  }
});

test('resolves bare executables only through the explicitly declared PATH', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
  const executable = join(directory, 'declared-tool');
  try {
    await symlink(process.execPath, executable);

    const declared = await runner.run(
      {
        ...baseRequest(),
        executable: 'declared-tool',
        arguments: ['-e', 'process.stdout.write("declared")'],
        environment: { PATH: directory },
      },
      unaborted(),
    );
    assert.equal(declared.status, 'succeeded');
    assert.equal(declared.stdout, 'declared');

    const ambientFallback = await runner.run(
      {
        ...baseRequest(),
        executable: 'node',
        arguments: ['-e', 'process.stdout.write("must-not-run")'],
        environment: {},
      },
      unaborted(),
    );
    assert.equal(ambientFallback.status, 'failed');
    assert.equal(ambientFallback.stdout, '');
    if (ambientFallback.status === 'failed') {
      assert.equal(ambientFallback.failure.code, 'executable_not_found');
      assert.match(ambientFallback.failure.message, /PATH is not declared/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('creates collision-free artifact IDs for identifiers containing delimiters', async () => {
  const output = [
    { portId: 'result', kind: 'text', source: 'stdout' },
  ] as const;
  const first = await runner.run(
    nodeRequest('process.stdout.write("first")', {
      runId: 'run:a',
      blockId: 'block',
      outputs: output,
    }),
    unaborted(),
  );
  const second = await runner.run(
    nodeRequest('process.stdout.write("second")', {
      runId: 'run',
      blockId: 'a:block',
      outputs: output,
    }),
    unaborted(),
  );

  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.notEqual(first.artifacts[0]?.id, second.artifacts[0]?.id);
});

test('uses shell evaluation only when explicitly requested', async () => {
  const result = await runner.run(
    {
      ...baseRequest(),
      executable: `${process.execPath} -e 'process.stdout.write("through-shell")'`,
      arguments: [],
      shell: true,
    },
    unaborted(),
  );

  assert.equal(result.status, 'succeeded');
  assert.equal(result.stdout, 'through-shell');
});

test('returns typed executable and working-directory launch failures', async () => {
  const executableResult = await runner.run(
    {
      ...baseRequest(),
      executable: join(tmpdir(), 'definitely-missing-vorkflo-executable'),
    },
    unaborted(),
  );
  assert.equal(executableResult.status, 'failed');
  if (executableResult.status === 'failed') {
    assert.equal(executableResult.failure.code, 'executable_not_found');
  }

  const workingDirectoryResult = await runner.run(
    {
      ...baseRequest(),
      executable: process.execPath,
      workingDirectory: join(tmpdir(), 'definitely-missing-vorkflo-cwd'),
    },
    unaborted(),
  );
  assert.equal(workingDirectoryResult.status, 'failed');
  if (workingDirectoryResult.status === 'failed') {
    assert.equal(
      workingDirectoryResult.failure.code,
      'working_directory_not_found',
    );
  }
});

test('captures nonzero exits as typed failures', async () => {
  const result = await runner.run(
    nodeRequest('process.stderr.write("bad input"); process.exit(7);'),
    unaborted(),
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, 'bad input');
  if (result.status === 'failed') {
    assert.equal(result.failure.code, 'process_exit_nonzero');
    assert.equal(result.failure.exitCode, 7);
  }
});

test(
  'captures signal termination as a distinct typed failure',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runner.run(
      nodeRequest("process.kill(process.pid, 'SIGTERM');"),
      unaborted(),
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, null);
    if (result.status === 'failed') {
      assert.equal(result.failure.code, 'process_terminated_by_signal');
      assert.equal(result.failure.signal, 'SIGTERM');
    }
  },
);

test('does not leak a stdin pipe error when a process exits without reading', async () => {
  const result = await runner.run(
    nodeRequest('process.exit(0)', { stdin: 'x'.repeat(1024 * 1024) }),
    unaborted(),
  );

  assert.equal(result.status, 'succeeded');
});

test('validates and produces filesystem reference artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
  try {
    const result = await runner.run(
      nodeRequest(
        `
          const fs = require('node:fs');
          fs.writeFileSync('result.txt', 'created');
        `,
        {
          workingDirectory: directory,
          outputs: [
            {
              portId: 'file',
              kind: 'filesystem-reference',
              path: 'result.txt',
              entity: 'file',
            },
          ],
        },
      ),
      unaborted(),
    );

    assert.equal(result.status, 'succeeded');
    assert.equal(
      await readFile(join(directory, 'result.txt'), 'utf8'),
      'created',
    );
    assert.deepEqual(result.artifacts[0], {
      id: '["run-1","block-1","file"]',
      kind: 'filesystem-reference',
      provenance: {
        runId: 'run-1',
        blockId: 'block-1',
        portId: 'file',
        createdAt: '2026-07-09T12:00:00.000Z',
      },
      path: join(directory, 'result.txt'),
      entity: 'file',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns typed output interpretation failures', async () => {
  const invalidJson = await runner.run(
    nodeRequest('process.stdout.write("not-json")', {
      outputs: [{ portId: 'json', kind: 'json', source: 'stdout' }],
    }),
    unaborted(),
  );
  assert.equal(invalidJson.status, 'failed');
  if (invalidJson.status === 'failed') {
    assert.equal(invalidJson.failure.code, 'invalid_json_output');
  }

  const missingFile = await runner.run(
    nodeRequest('', {
      outputs: [
        {
          portId: 'file',
          kind: 'filesystem-reference',
          path: join(tmpdir(), 'definitely-missing-vorkflo-output'),
        },
      ],
    }),
    unaborted(),
  );
  assert.equal(missingFile.status, 'failed');
  if (missingFile.status === 'failed') {
    assert.equal(missingFile.failure.code, 'filesystem_reference_inaccessible');
  }

  const specialPathRunner = new NodeProcessRunner({
    async statPath() {
      return { isFile: () => false, isDirectory: () => false };
    },
  });
  const specialPath = await specialPathRunner.run(
    nodeRequest('', {
      outputs: [
        {
          portId: 'special',
          kind: 'filesystem-reference',
          path: '/virtual-special-node',
        },
      ],
    }),
    unaborted(),
  );
  assert.equal(specialPath.status, 'failed');
  if (specialPath.status === 'failed') {
    assert.equal(specialPath.failure.code, 'filesystem_reference_inaccessible');
    assert.match(specialPath.failure.message, /neither a regular file/);
  }
});

test('returns immediately when cancellation was already requested', async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await runner.run(
    nodeRequest('process.stdout.write("must not run")'),
    { signal: controller.signal },
  );

  assert.equal(result.status, 'cancelled');
  assert.equal(result.stdout, '');
});

test('does not launch after cancellation during working-directory validation', async () => {
  const controller = new AbortController();
  const raceRunner = new NodeProcessRunner({
    async statPath() {
      controller.abort();
      return { isDirectory: () => true, isFile: () => false };
    },
  });

  const result = await raceRunner.run(
    nodeRequest('process.stdout.write("must not run")', {
      workingDirectory: '/virtual-directory',
    }),
    { signal: controller.signal },
  );

  assert.equal(result.status, 'cancelled');
  assert.equal(result.stdout, '');
});

test('cancellation takes precedence over a racing cwd validation failure', async () => {
  const controller = new AbortController();
  const raceRunner = new NodeProcessRunner({
    async statPath() {
      controller.abort();
      throw new Error('late path failure');
    },
  });

  const result = await raceRunner.run(
    nodeRequest('process.stdout.write("must not run")', {
      workingDirectory: '/virtual-directory',
    }),
    { signal: controller.signal },
  );

  assert.equal(result.status, 'cancelled');
});

test('cancels while resolving a filesystem artifact after process exit', async () => {
  const controller = new AbortController();
  let resolveStat:
    | ((value: { isFile(): boolean; isDirectory(): boolean }) => void)
    | undefined;
  let markStatStarted: (() => void) | undefined;
  const statStarted = new Promise<void>((resolve) => {
    markStatStarted = resolve;
  });
  const raceRunner = new NodeProcessRunner({
    statPath() {
      markStatStarted?.();
      return new Promise((resolve) => {
        resolveStat = resolve;
      });
    },
  });
  const resultPromise = raceRunner.run(
    nodeRequest('', {
      outputs: [
        {
          portId: 'file',
          kind: 'filesystem-reference',
          path: '/virtual-output',
        },
      ],
    }),
    { signal: controller.signal },
  );

  await statStarted;
  controller.abort();
  const result = await resultPromise;
  resolveStat?.({ isFile: () => true, isDirectory: () => false });

  assert.equal(result.status, 'cancelled');
});

test('cancels a running process and its POSIX process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
  const pidFile = join(directory, 'descendant.pid');
  const controller = new AbortController();
  let descendantPid: number | undefined;

  try {
    const resultPromise = runner.run(
      nodeRequest(
        `
          const { spawn } = require('node:child_process');
          const fs = require('node:fs');
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
          fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
          process.stdout.write('started');
          setInterval(() => {}, 1000);
        `,
      ),
      { signal: controller.signal },
    );

    descendantPid = Number(await waitForFile(pidFile));
    controller.abort();
    const result = await resultPromise;

    assert.equal(result.status, 'cancelled');
    assert.equal(result.stdout, 'started');
    if (process.platform !== 'win32') {
      await waitForProcessExit(descendantPid);
    }
  } finally {
    if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('times out a running process and its POSIX process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
  const pidFile = join(directory, 'timeout-descendant.pid');
  let descendantPid: number | undefined;

  try {
    const result = await runner.run(
      nodeRequest(
        `
          const { spawn } = require('node:child_process');
          const fs = require('node:fs');
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
          fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
          process.stdout.write('started');
          setInterval(() => {}, 1000);
        `,
        { timeoutMs: 500 },
      ),
      unaborted(),
    );

    descendantPid = Number(await readFile(pidFile, 'utf8'));
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.failure.code, 'process_timeout');
      assert.match(result.failure.message, /500 ms/);
      assert.match(result.failure.nextAction ?? '', /Increase/);
    }
    assert.equal(result.stdout, 'started');
    if (process.platform !== 'win32') {
      await waitForProcessExit(descendantPid);
    }
  } finally {
    if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('leaves a process that finishes within its timeout unaffected', async () => {
  const result = await runner.run(
    nodeRequest("process.stdout.write('finished')", { timeoutMs: 1_000 }),
    unaborted(),
  );

  assert.equal(result.status, 'succeeded');
  assert.equal(result.stdout, 'finished');
});

test(
  'user cancellation takes precedence after a timeout requests termination',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
    const readyFile = join(directory, 'timeout-ready');
    const termFile = join(directory, 'timeout-term');
    const controller = new AbortController();

    try {
      const resultPromise = runner.run(
        nodeRequest(
          `
            const fs = require('node:fs');
            process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(termFile)}, 'term'));
            fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
            setInterval(() => {}, 1000);
          `,
          { timeoutMs: 200 },
        ),
        { signal: controller.signal },
      );

      await waitForFile(readyFile);
      await waitForFile(termFile);
      controller.abort();
      const result = await resultPromise;

      assert.equal(result.status, 'cancelled');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'escalates to SIGKILL when a POSIX process ignores SIGTERM',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vorkflo-node-runner-'));
    const readyFile = join(directory, 'ready');
    const controller = new AbortController();

    try {
      const resultPromise = runner.run(
        nodeRequest(`
          const fs = require('node:fs');
          process.on('SIGTERM', () => {});
          fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
          setInterval(() => {}, 1000);
        `),
        { signal: controller.signal },
      );

      await waitForFile(readyFile);
      controller.abort();
      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('SIGKILL escalation timed out.')),
            2_000,
          );
          timer.unref();
        }),
      ]);

      assert.equal(result.status, 'cancelled');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

function baseRequest(): ProcessRunRequest {
  return {
    runId: 'run-1',
    blockId: 'block-1',
    executable: process.execPath,
    arguments: ['-e', ''],
    shell: false,
    environment: {},
    outputs: [],
  };
}

function nodeRequest(
  source: string,
  overrides: Partial<ProcessRunRequest> = {},
): ProcessRunRequest {
  return {
    ...baseRequest(),
    arguments: ['-e', source],
    ...overrides,
  };
}

function unaborted(): { readonly signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Process ${pid} remained alive after cancellation.`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
