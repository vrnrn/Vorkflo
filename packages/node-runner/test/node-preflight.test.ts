import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  preflightWorkflow,
  type ProcessBlock,
  type ProcessRunRequest,
  type WorkflowDefinition,
} from '@vorkflo/engine';

import {
  canonicalizeNodeWorkflowRunInputs,
  NodeProcessRunner,
  NodeWorkflowPreflight,
} from '../src/index.js';

test('preflight performs zero process launches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-preflight-'));
  const marker = join(directory, 'must-not-exist');
  try {
    const block = processBlock('safe', {
      executable: process.execPath,
      timeoutMs: 2_500,
      arguments: [
        { type: 'literal', value: '-e' },
        {
          type: 'literal',
          value: `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`,
        },
      ],
      workingDirectory: directory,
    });

    const result = await preflightWorkflow(
      workflowWith([block]),
      new NodeWorkflowPreflight(),
    );

    assert.equal(result.ready, true);
    assert.equal(result.blocks[0]?.resolvedExecutable, process.execPath);
    assert.equal(result.blocks[0]?.timeoutMs, 2_500);
    await assert.rejects(readFile(marker, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preflight blocks missing host values, executable PATH, cwd, and filesystem input', async () => {
  const missingDirectory = join(
    tmpdir(),
    'definitely-missing-vorkflo-preflight-cwd',
  );
  const block = processBlock('blocked', {
    executable: 'missing-tool',
    workingDirectory: missingDirectory,
    environment: {
      PATH: { source: 'host', name: 'DECLARED_PATH' },
      TOKEN: { source: 'host', name: 'DECLARED_TOKEN' },
    },
    inputs: [
      {
        id: 'source',
        name: 'Source',
        artifactKind: 'filesystem-reference',
        required: true,
      },
    ],
    arguments: [{ type: 'input', portId: 'source' }],
  });
  const workflow = workflowWith([block]);
  workflow.inputs = [
    {
      id: 'source',
      name: 'Source',
      artifactKind: 'filesystem-reference',
      required: true,
    },
  ];
  workflow.inputBindings = [
    {
      id: 'source-blocked',
      inputId: 'source',
      to: { blockId: 'blocked', portId: 'source' },
    },
  ];

  const result = await preflightWorkflow(
    workflow,
    new NodeWorkflowPreflight(),
    {
      hostEnvironment: {},
      runInputs: {
        source: {
          kind: 'filesystem-reference',
          path: join(tmpdir(), 'definitely-missing-vorkflo-input'),
          entity: 'file',
        },
      },
    },
  );

  assert.equal(result.ready, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('adapter_host_environment_missing'));
  assert.ok(codes.includes('adapter_executable_path_unavailable'));
  assert.ok(codes.includes('adapter_working_directory_inaccessible'));
  assert.ok(codes.includes('adapter_filesystem_input_inaccessible'));
  assert.deepEqual(
    result.issues.find(
      (issue) => issue.code === 'adapter_host_environment_missing',
    ),
    {
      severity: 'blocker',
      code: 'adapter_host_environment_missing',
      message:
        'Host environment variable "DECLARED_PATH" is required but unavailable.',
      path: 'blocks[0].invocation.environment.PATH',
      blockId: 'blocked',
      field: 'invocation.environment.PATH',
    },
  );
});

test('preflight resolves executables only through the declared PATH', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-preflight-'));
  const bin = join(directory, 'bin');
  const executable = join(bin, 'fixture-tool');
  try {
    await mkdir(bin);
    await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(executable, 0o755);
    const declared = processBlock('declared', {
      executable: 'fixture-tool',
      workingDirectory: directory,
      environment: { PATH: { source: 'literal', value: bin } },
    });
    const ambientOnly = processBlock('ambient-only', {
      executable: 'node',
      workingDirectory: directory,
    });
    const declaredMissing = processBlock('declared-missing', {
      executable: 'missing-tool',
      workingDirectory: directory,
      environment: { PATH: { source: 'literal', value: bin } },
    });

    const result = await preflightWorkflow(
      workflowWith([declared, ambientOnly, declaredMissing]),
      new NodeWorkflowPreflight(),
    );

    assert.equal(result.blocks[0]?.resolvedExecutable, executable);
    assert.equal(result.blocks[1]?.resolvedExecutable, undefined);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.blockId === 'ambient-only' &&
          issue.code === 'adapter_executable_path_unavailable',
      ),
    );
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.blockId === 'declared-missing' &&
          issue.code === 'adapter_executable_not_found',
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preflight resolves future relative and absolute outputs without requiring them to exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-preflight-'));
  try {
    const absoluteOutput = join(directory, 'absolute.txt');
    const block = processBlock('outputs', {
      executable: process.execPath,
      workingDirectory: directory,
      outputs: [
        {
          id: 'relative',
          name: 'Relative',
          artifactKind: 'filesystem-reference',
        },
        {
          id: 'absolute',
          name: 'Absolute',
          artifactKind: 'filesystem-reference',
        },
      ],
      outputBindings: [
        {
          type: 'filesystem',
          portId: 'relative',
          path: 'nested/future.txt',
          entity: 'file',
        },
        {
          type: 'filesystem',
          portId: 'absolute',
          path: absoluteOutput,
          entity: 'file',
        },
      ],
    });

    const result = await preflightWorkflow(
      workflowWith([block]),
      new NodeWorkflowPreflight(),
    );

    assert.equal(result.ready, true);
    assert.deepEqual(result.blocks[0]?.outputs, [
      {
        portId: 'relative',
        path: join(directory, 'nested/future.txt'),
        entity: 'file',
      },
      { portId: 'absolute', path: absoluteOutput, entity: 'file' },
    ]);
    assert.equal(
      result.issues.some((issue) =>
        issue.code.startsWith('adapter_filesystem_output'),
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preflight separates shell and destructive-path warnings from blockers', async () => {
  const adapter = new NodeWorkflowPreflight({
    async statPath(path) {
      const executable = path === process.execPath;
      return {
        isDirectory: () => !executable,
        isFile: () => executable,
      };
    },
    async accessPath() {},
  });
  const shellBlock = processBlock('shell', {
    executable: 'printf > output.txt',
    shell: true,
    outputs: [
      {
        id: 'root',
        name: 'Root',
        artifactKind: 'filesystem-reference',
      },
    ],
    outputBindings: [
      {
        type: 'filesystem',
        portId: 'root',
        path: '/System/vorkflo-output',
        entity: 'unknown',
      },
    ],
  });
  const directBlock = processBlock('direct', {
    executable: process.execPath,
    arguments: [{ type: 'literal', value: '>> output.txt' }],
  });

  const result = await preflightWorkflow(
    workflowWith([shellBlock, directBlock]),
    adapter,
  );

  assert.equal(result.ready, true);
  assert.deepEqual(
    result.issues.map(({ code, severity, blockId, field }) => ({
      code,
      severity,
      blockId,
      field,
    })),
    [
      {
        code: 'adapter_shell_mode',
        severity: 'warning',
        blockId: 'shell',
        field: 'invocation.shell',
      },
      {
        code: 'adapter_destructive_output_path',
        severity: 'warning',
        blockId: 'shell',
        field: 'invocation.outputs[0].path',
      },
      {
        code: 'adapter_shell_syntax_literal',
        severity: 'warning',
        blockId: 'direct',
        field: 'invocation.arguments[0]',
      },
    ],
  );
});

test('preflight reports an unwritable output parent as a blocker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-preflight-'));
  try {
    const block = processBlock('unwritable', {
      executable: process.execPath,
      workingDirectory: directory,
      outputs: [
        {
          id: 'file',
          name: 'File',
          artifactKind: 'filesystem-reference',
        },
      ],
      outputBindings: [
        {
          type: 'filesystem',
          portId: 'file',
          path: 'future.txt',
          entity: 'file',
        },
      ],
    });
    const adapter = new NodeWorkflowPreflight({
      async accessPath(path, mode) {
        if (path === directory && mode === (constants.W_OK | constants.X_OK)) {
          const error = new Error('permission denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
      },
    });

    const result = await preflightWorkflow(workflowWith([block]), adapter);

    assert.equal(result.ready, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === 'adapter_filesystem_output_parent_inaccessible' &&
          issue.blockId === 'unwritable' &&
          issue.field === 'invocation.outputs[0].path',
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('canonicalizes relative filesystem run inputs against the host base directory', () => {
  const workflow = workflowWith([]);
  workflow.inputs = [
    {
      id: 'source',
      name: 'Source',
      artifactKind: 'filesystem-reference',
      required: true,
    },
  ];
  const portable = {
    source: {
      kind: 'filesystem-reference' as const,
      path: './inputs/source.txt',
      entity: 'file' as const,
    },
  };

  const canonical = canonicalizeNodeWorkflowRunInputs(
    workflow,
    portable,
    '/workflow/base',
  );

  assert.equal(
    canonical.source?.kind === 'filesystem-reference'
      ? canonical.source.path
      : undefined,
    '/workflow/base/inputs/source.txt',
  );
  assert.equal(portable.source.path, './inputs/source.txt');
});

test('preflight rejects an existing special filesystem output with unknown entity', async () => {
  const outputPath = '/virtual/special-output';
  const block = processBlock('special-output', {
    executable: process.execPath,
    outputs: [
      {
        id: 'special',
        name: 'Special',
        artifactKind: 'filesystem-reference',
      },
    ],
    outputBindings: [
      {
        type: 'filesystem',
        portId: 'special',
        path: outputPath,
        entity: 'unknown',
      },
    ],
  });
  const adapter = new NodeWorkflowPreflight({
    async statPath(path) {
      if (path === process.execPath) {
        return { isDirectory: () => false, isFile: () => true };
      }
      if (path === outputPath) {
        return { isDirectory: () => false, isFile: () => false };
      }
      return { isDirectory: () => true, isFile: () => false };
    },
    async accessPath() {},
  });

  const result = await preflightWorkflow(workflowWith([block]), adapter);

  assert.equal(result.ready, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'adapter_filesystem_output_unsupported_entity' &&
        issue.blockId === 'special-output' &&
        issue.field === 'invocation.outputs[0].path',
    ),
  );
});

test('preflight and runner use identical filesystem path resolution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-preflight-'));
  const workspace = join(directory, 'workspace');
  try {
    await mkdir(workspace);
    const block = processBlock('parity', {
      executable: process.execPath,
      workingDirectory: 'workspace',
      arguments: [
        { type: 'literal', value: '-e' },
        {
          type: 'literal',
          value:
            "require('node:fs').mkdirSync('out',{recursive:true});require('node:fs').writeFileSync('out/result.txt','ok')",
        },
      ],
      outputs: [
        {
          id: 'file',
          name: 'File',
          artifactKind: 'filesystem-reference',
        },
      ],
      outputBindings: [
        {
          type: 'filesystem',
          portId: 'file',
          path: 'out/result.txt',
          entity: 'file',
        },
      ],
    });
    const workflow = workflowWith([block]);
    const preflight = await preflightWorkflow(
      workflow,
      new NodeWorkflowPreflight({ baseDirectory: directory }),
    );
    assert.equal(preflight.ready, true);

    const request: ProcessRunRequest = {
      runId: 'path-parity',
      blockId: 'parity',
      executable: block.invocation.executable,
      arguments: block.invocation.arguments.map((argument) =>
        argument.type === 'literal' ? argument.value : '',
      ),
      shell: false,
      ...(block.invocation.workingDirectory === undefined
        ? {}
        : { workingDirectory: block.invocation.workingDirectory }),
      environment: {},
      outputs: [
        {
          portId: 'file',
          kind: 'filesystem-reference',
          path: 'out/result.txt',
          entity: 'file',
        },
      ],
    };
    const run = await new NodeProcessRunner({ baseDirectory: directory }).run(
      request,
      { signal: new AbortController().signal },
    );

    assert.equal(run.status, 'succeeded');
    assert.equal(
      run.artifacts[0]?.kind === 'filesystem-reference'
        ? run.artifacts[0].path
        : undefined,
      preflight.blocks[0]?.outputs[0]?.path,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

interface ProcessBlockOptions {
  readonly executable?: string;
  readonly arguments?: ProcessBlock['invocation']['arguments'];
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly environment?: ProcessBlock['invocation']['environment'];
  readonly shell?: boolean;
  readonly inputs?: ProcessBlock['inputs'];
  readonly outputs?: ProcessBlock['outputs'];
  readonly outputBindings?: ProcessBlock['invocation']['outputs'];
}

function processBlock(
  id: string,
  options: ProcessBlockOptions = {},
): ProcessBlock {
  return {
    id,
    name: id,
    kind: 'process',
    inputs: options.inputs ?? [],
    outputs: options.outputs ?? [],
    invocation: {
      executable: options.executable ?? process.execPath,
      arguments: options.arguments ?? [],
      ...(options.workingDirectory === undefined
        ? {}
        : { workingDirectory: options.workingDirectory }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      environment: options.environment ?? {},
      shell: options.shell ?? false,
      outputs: options.outputBindings ?? [],
    },
  };
}

function workflowWith(blocks: ProcessBlock[]): WorkflowDefinition {
  return {
    schemaVersion: 2,
    id: 'preflight-workflow',
    name: 'Preflight workflow',
    inputs: [],
    inputBindings: [],
    blocks,
    connections: [],
  };
}
