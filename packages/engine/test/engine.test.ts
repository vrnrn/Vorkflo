import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createExecutionPlan,
  InvalidWorkflowError,
  parseWorkflowDefinition,
  preflightWorkflow,
  validateWorkflow,
  type ArtifactKind,
  type InputPort,
  type OutputPort,
  type ProcessBlock,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowPreflightAdapter,
} from '../src/index.js';

test('parses a versioned workflow and applies safe invocation defaults', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'hello',
    name: 'Hello',
    blocks: [
      {
        id: 'echo',
        name: 'Echo',
        kind: 'process',
        invocation: {
          executable: 'printf',
        },
      },
    ],
    connections: [],
  });

  assert.equal(workflow.schemaVersion, 2);
  assert.deepEqual(workflow.inputs, []);
  assert.deepEqual(workflow.inputBindings, []);
  assert.equal(workflow.blocks[0]?.invocation.shell, false);
  assert.deepEqual(workflow.blocks[0]?.invocation.arguments, []);
  assert.deepEqual(
    Object.keys(workflow.blocks[0]?.invocation.environment ?? {}),
    [],
  );
  assert.equal(workflow.blocks[0]?.invocation.timeoutMs, undefined);
});

test('parses a bounded process timeout and rejects invalid timeout values', () => {
  const serialized = {
    schemaVersion: 2,
    id: 'timeout-contract',
    name: 'Timeout contract',
    inputs: [],
    inputBindings: [],
    blocks: [
      {
        id: 'bounded',
        name: 'Bounded process',
        kind: 'process',
        inputs: [],
        outputs: [],
        invocation: {
          executable: 'fixture-process',
          timeoutMs: 30_000,
        },
      },
    ],
    connections: [],
  };

  const workflow = parseWorkflowDefinition(serialized);
  assert.equal(workflow.blocks[0]?.invocation.timeoutMs, 30_000);

  for (const timeoutMs of [0, -1, 1.5, 2_147_483_648]) {
    assert.throws(() =>
      parseWorkflowDefinition({
        ...serialized,
        blocks: [
          {
            ...serialized.blocks[0],
            invocation: { ...serialized.blocks[0]?.invocation, timeoutMs },
          },
        ],
      }),
    );
  }
});

test('migrates the locked v1 fixture to the canonical v2 schema', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../test/fixtures/workflow-v1.vorkflo.json', import.meta.url),
      'utf8',
    ),
  ) as unknown;

  const workflow = parseWorkflowDefinition(fixture);

  assert.equal(workflow.schemaVersion, 2);
  assert.equal(workflow.id, 'locked-v1-fixture');
  assert.deepEqual(workflow.inputs, []);
  assert.deepEqual(workflow.inputBindings, []);
  assert.equal(Object.hasOwn(workflow, 'editor'), false);
  assert.deepEqual(workflow.layout?.blockPositions.source, { x: 120, y: 80 });
  assert.equal(workflow.blocks[0]?.invocation.executable, 'printf');
});

test('round-trips canonical v2 workflow inputs and opaque editor metadata', () => {
  const serialized = {
    schemaVersion: 2,
    id: 'v2-round-trip',
    name: 'v2 round trip',
    inputs: [
      {
        id: 'prompt',
        name: 'Prompt',
        artifactKind: 'text',
        required: true,
      },
      {
        id: 'settings',
        name: 'Settings',
        artifactKind: 'json',
        required: false,
        defaultValue: {
          kind: 'json',
          value: { mode: 'compact', nested: [true, null, 2] },
        },
      },
    ],
    inputBindings: [],
    blocks: [],
    connections: [],
    editor: {
      blockPresentation: { source: 'specialized-editor', version: 1 },
      collapsedGroups: ['advanced'],
    },
  };

  const workflow = parseWorkflowDefinition(serialized);
  const roundTripped = parseWorkflowDefinition(
    JSON.parse(JSON.stringify(workflow)),
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(roundTripped)),
    JSON.parse(JSON.stringify(workflow)),
  );
  assert.equal(Object.hasOwn(workflow.inputs[0] ?? {}, 'defaultValue'), false);
  assert.equal(workflow.inputs[1]?.defaultValue?.kind, 'json');
  assert.deepEqual(
    JSON.parse(JSON.stringify(workflow.editor)),
    serialized.editor,
  );

  assert.throws(() =>
    parseWorkflowDefinition({ ...serialized, hiddenAuthority: true }),
  );
});

test('rejects non-JSON and unsafe editor metadata record shapes', () => {
  const base = {
    schemaVersion: 2,
    id: 'editor-safety',
    name: 'Editor safety',
    inputs: [],
    inputBindings: [],
    blocks: [],
    connections: [],
  };
  const customPrototype = Object.create({ inherited: true }) as Record<
    string,
    unknown
  >;
  customPrototype.visible = true;
  const symbolRecord = { visible: true } as Record<PropertyKey, unknown>;
  symbolRecord[Symbol('hidden')] = true;
  const nonEnumerableRecord: Record<string, unknown> = {};
  Object.defineProperty(nonEnumerableRecord, 'hidden', {
    value: true,
    enumerable: false,
  });
  const accessorRecord: Record<string, unknown> = {};
  Object.defineProperty(accessorRecord, 'computed', {
    get: () => true,
    enumerable: true,
  });

  for (const editor of [
    { invalid: undefined },
    { invalid: Number.POSITIVE_INFINITY },
    { invalid: new Date() },
    customPrototype,
    symbolRecord,
    nonEnumerableRecord,
    accessorRecord,
  ]) {
    assert.throws(() => parseWorkflowDefinition({ ...base, editor }));
  }
});

test('rejects unknown serialized fields', () => {
  assert.throws(() =>
    parseWorkflowDefinition({
      schemaVersion: 1,
      id: 'unsafe',
      name: 'Unsafe',
      blocks: [],
      connections: [],
      hiddenCommand: 'rm -rf /',
    }),
  );
});

test('rejects non-portable child and host environment variable names', () => {
  for (const invalidName of [
    'A=B',
    '1TOKEN',
    'HAS-DASH',
    'NULL\0BYTE',
    '__proto__',
    'constructor',
    'prototype',
    'toString',
  ]) {
    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-environment',
        name: 'Invalid environment',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: {
                [invalidName]: { source: 'literal', value: 'value' },
              },
            },
          },
        ],
        connections: [],
      }),
    );

    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-host-environment',
        name: 'Invalid host environment',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: {
                VALID_TARGET: { source: 'host', name: invalidName },
              },
            },
          },
        ],
        connections: [],
      }),
    );
  }

  const declaredProtoBinding = JSON.parse(
    '{"__proto__":{"source":"literal","value":"must-not-disappear"}}',
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(declaredProtoBinding), ['__proto__']);
  assert.throws(() =>
    parseWorkflowDefinition({
      schemaVersion: 1,
      id: 'proto-environment',
      name: 'Proto environment',
      blocks: [
        {
          id: 'process',
          name: 'Process',
          kind: 'process',
          invocation: {
            executable: 'fixture-command',
            environment: declaredProtoBinding,
          },
        },
      ],
      connections: [],
    }),
  );
});

test('accepts portable child and host environment variable names', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'portable-environment',
    name: 'Portable environment',
    blocks: [
      {
        id: 'process',
        name: 'Process',
        kind: 'process',
        invocation: {
          executable: 'fixture-command',
          environment: {
            _PRIVATE: { source: 'literal', value: 'value' },
            TOKEN_2: { source: 'host', name: 'HOST_TOKEN_2' },
          },
        },
      },
    ],
    connections: [],
  });

  assert.deepEqual(
    { ...workflow.blocks[0]?.invocation.environment },
    {
      _PRIVATE: { source: 'literal', value: 'value' },
      TOKEN_2: { source: 'host', name: 'HOST_TOKEN_2' },
    },
  );
});

test('rejects non-record objects for environment and layout records', () => {
  for (const invalidRecord of [new Date(), new Map<string, unknown>()]) {
    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-record',
        name: 'Invalid record',
        blocks: [
          {
            id: 'process',
            name: 'Process',
            kind: 'process',
            invocation: {
              executable: 'fixture-command',
              environment: invalidRecord,
            },
          },
        ],
        connections: [],
      }),
    );

    assert.throws(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'invalid-layout-record',
        name: 'Invalid layout record',
        blocks: [],
        connections: [],
        layout: { blockPositions: invalidRecord },
      }),
    );
  }
});

test('parses explicit stderr and filesystem output declarations', () => {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'declared-outputs',
    name: 'Declared outputs',
    blocks: [
      {
        id: 'producer',
        name: 'Producer',
        kind: 'process',
        outputs: [
          { id: 'diagnostic', name: 'Diagnostic', artifactKind: 'text' },
          {
            id: 'directory',
            name: 'Directory',
            artifactKind: 'filesystem-reference',
          },
        ],
        invocation: {
          executable: 'fixture-command',
          outputs: [
            { type: 'stderr', portId: 'diagnostic' },
            {
              type: 'filesystem',
              portId: 'directory',
              path: '/tmp/output',
              entity: 'directory',
            },
          ],
        },
      },
    ],
    connections: [],
  });

  assert.deepEqual(workflow.blocks[0]?.invocation.outputs, [
    { type: 'stderr', portId: 'diagnostic' },
    {
      type: 'filesystem',
      portId: 'directory',
      path: '/tmp/output',
      entity: 'directory',
    },
  ]);
  assert.equal(validateWorkflow(workflow).valid, true);
});

test('creates stable parallel execution layers for a valid DAG', () => {
  const workflow = workflowWith(
    [
      processBlock('news', [], [outputPort('summary')]),
      processBlock('notes', [], [outputPort('summary')]),
      processBlock(
        'combine',
        [inputPort('news'), inputPort('notes')],
        [outputPort('report')],
      ),
    ],
    [
      connection('news-to-combine', 'news', 'summary', 'combine', 'news'),
      connection('notes-to-combine', 'notes', 'summary', 'combine', 'notes'),
    ],
  );

  assert.deepEqual(createExecutionPlan(workflow).layers, [
    ['news', 'notes'],
    ['combine'],
  ]);
});

test('reports cycles instead of planning them', () => {
  const workflow = workflowWith(
    [
      processBlock('a', [inputPort('in')], [outputPort('out')]),
      processBlock('b', [inputPort('in')], [outputPort('out')]),
    ],
    [
      connection('a-to-b', 'a', 'out', 'b', 'in'),
      connection('b-to-a', 'b', 'out', 'a', 'in'),
    ],
  );

  const validation = validateWorkflow(workflow);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'cycle_detected'));
  assert.throws(
    () => createExecutionPlan(workflow),
    (error: unknown) => error instanceof InvalidWorkflowError,
  );
});

test('reports incompatible artifact kinds', () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('out', 'text')]),
      processBlock('target', [inputPort('in', 'json')], []),
    ],
    [connection('source-to-target', 'source', 'out', 'target', 'in')],
  );

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'incompatible_artifact_kinds',
    ),
  );
});

test('reports required inputs that have no connection', () => {
  const workflow = workflowWith([
    processBlock('target', [inputPort('required')], []),
  ]);

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'required_input_unconnected',
    ),
  );
});

test('preflight normalizes static and run-input blockers with field targets', async () => {
  const workflow = workflowWith([
    processBlock('target', [inputPort('required')], []),
  ]);
  workflow.inputs = [workflowInput('manual', 'text', true)];
  const adapter: WorkflowPreflightAdapter = {
    async preflight() {
      return {
        issues: [
          {
            severity: 'warning',
            code: 'adapter_fixture_warning',
            message: 'Fixture warning.',
            path: 'blocks[0].invocation.shell',
            blockId: 'target',
            field: 'invocation.shell',
          },
        ],
        blocks: [],
      };
    },
  };

  const result = await preflightWorkflow(workflow, adapter);

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.issues.find((issue) => issue.code === 'required_input_unconnected'),
    {
      severity: 'blocker',
      code: 'required_input_unconnected',
      message:
        'Required input "required" on block "target" has no graph connection or workflow-input binding.',
      path: 'blocks[0].inputs[0]',
      field: 'inputs[0]',
      blockId: 'target',
    },
  );
  assert.ok(
    result.issues.some((issue) => issue.code === 'missing_required_run_input'),
  );
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.severity === 'warning' &&
        issue.code === 'adapter_fixture_warning',
    ),
  );
});

test('preflight turns adapter rejection into a typed blocker', async () => {
  const result = await preflightWorkflow(
    workflowWith([]),
    {
      async preflight() {
        throw new Error('adapter unavailable');
      },
    },
    { hostEnvironment: {} },
  );

  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, [
    {
      severity: 'blocker',
      code: 'preflight_adapter_failed',
      message: 'adapter unavailable',
      path: 'workflow',
      field: 'workflow',
    },
  ]);
});

test('preflight maps connection issues to the responsible block field', async () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('payload', 'json')]),
      processBlock('target', [inputPort('payload', 'text')], []),
    ],
    [connection('source-target', 'source', 'payload', 'target', 'payload')],
  );
  const adapter: WorkflowPreflightAdapter = {
    async preflight() {
      return { issues: [], blocks: [] };
    },
  };

  const incompatible = (await preflightWorkflow(workflow, adapter)).issues.find(
    (issue) => issue.code === 'incompatible_artifact_kinds',
  );

  assert.deepEqual(incompatible, {
    severity: 'blocker',
    code: 'incompatible_artifact_kinds',
    message: 'Cannot connect json output to text input.',
    path: 'connections[0]',
    field: 'inputs',
    blockId: 'target',
  });

  workflow.connections[0] = connection(
    'source-target',
    'source',
    'missing-output',
    'target',
    'payload',
  );
  const missingSourcePort = (
    await preflightWorkflow(workflow, adapter)
  ).issues.find((issue) => issue.code === 'missing_source_port');

  assert.deepEqual(missingSourcePort, {
    severity: 'blocker',
    code: 'missing_source_port',
    message: 'Output port "missing-output" does not exist on block "source".',
    path: 'connections[0].from.portId',
    field: 'outputs',
    blockId: 'source',
  });
});

test('allows exactly one workflow-input binding to satisfy a required block input', () => {
  const workflow = workflowWith([
    processBlock('target', [inputPort('prompt', 'text')], []),
  ]);
  workflow.inputs = [workflowInput('prompt', 'text', true)];
  workflow.inputBindings = [
    {
      id: 'prompt-to-target',
      inputId: 'prompt',
      to: { blockId: 'target', portId: 'prompt' },
    },
  ];

  assert.deepEqual(validateWorkflow(workflow), { valid: true, issues: [] });
  assert.deepEqual(createExecutionPlan(workflow).layers, [['target']]);

  workflow.inputBindings.push({
    id: 'second-prompt-to-target',
    inputId: 'prompt',
    to: { blockId: 'target', portId: 'prompt' },
  });
  assert.ok(
    validateWorkflow(workflow).issues.some(
      (issue) => issue.code === 'multiple_bindings_to_input',
    ),
  );
});

test('rejects graph and workflow-input sources targeting the same block input', () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('out', 'text')]),
      processBlock('target', [inputPort('prompt', 'text')], []),
    ],
    [connection('source-target', 'source', 'out', 'target', 'prompt')],
  );
  workflow.inputs = [workflowInput('prompt', 'text', true)];
  workflow.inputBindings = [
    {
      id: 'prompt-to-target',
      inputId: 'prompt',
      to: { blockId: 'target', portId: 'prompt' },
    },
  ];

  const validation = validateWorkflow(workflow);

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'multiple_bindings_to_input',
    ),
  );
});

test('reports duplicate, missing, and kind-mismatched workflow-input bindings', () => {
  const workflow = workflowWith([
    processBlock('target', [inputPort('payload', 'json')], []),
  ]);
  workflow.inputs = [
    workflowInput('payload', 'text', true),
    workflowInput('payload', 'text', false),
    {
      ...workflowInput('bad-default', 'text', false),
      defaultValue: { kind: 'json', value: null },
    },
  ];
  workflow.inputBindings = [
    {
      id: 'duplicate-binding',
      inputId: 'payload',
      to: { blockId: 'target', portId: 'payload' },
    },
    {
      id: 'duplicate-binding',
      inputId: 'missing-input',
      to: { blockId: 'missing-block', portId: 'payload' },
    },
    {
      id: 'missing-port',
      inputId: 'payload',
      to: { blockId: 'target', portId: 'missing-port' },
    },
  ];

  const codes = validateWorkflow(workflow).issues.map((issue) => issue.code);

  assert.ok(codes.includes('duplicate_workflow_input_id'));
  assert.ok(codes.includes('duplicate_workflow_input_binding_id'));
  assert.ok(codes.includes('missing_workflow_input'));
  assert.ok(codes.includes('missing_workflow_input_target_block'));
  assert.ok(codes.includes('missing_workflow_input_target_port'));
  assert.ok(codes.includes('workflow_input_kind_mismatch'));
  assert.ok(codes.includes('workflow_input_default_kind_mismatch'));
});

test('tracks required input connections without delimiter collisions', () => {
  const workflow = workflowWith(
    [
      processBlock('source', [], [outputPort('out')]),
      processBlock('a:b', [inputPort('c')], []),
      processBlock('a', [inputPort('b:c')], []),
    ],
    [connection('connected', 'source', 'out', 'a', 'b:c')],
  );

  const validation = validateWorkflow(workflow);

  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === 'required_input_unconnected' &&
        issue.path === 'blocks[1].inputs[0]',
    ),
  );
});

test('requires every declared port to have an invocation binding', () => {
  const block = processBlock('broken', [], [outputPort('result')]);
  block.invocation.outputs = [];
  const workflow = workflowWith([block]);

  const validation = validateWorkflow(workflow);
  assert.ok(
    validation.issues.some((issue) => issue.code === 'output_port_unbound'),
  );
});

test('counts argument and stdin template inputs as invocation bindings', () => {
  const block = processBlock(
    'template-bindings',
    [inputPort('argument'), inputPort('stdin')],
    [],
  );
  block.inputs[0]!.required = false;
  block.inputs[1]!.required = false;
  block.invocation.arguments = [
    {
      type: 'template',
      template: 'prompt={{prompt}}',
      inputs: { prompt: { portId: 'argument' } },
    },
  ];
  block.invocation.stdin = {
    template: '{{body}}',
    inputs: { body: { portId: 'stdin' } },
  };

  assert.deepEqual(validateWorkflow(workflowWith([block])).issues, []);
});

test('does not count literal template values as block input bindings', () => {
  const block = processBlock('literal-template', [inputPort('unbound')], []);
  block.inputs[0]!.required = false;
  block.invocation.arguments = [
    {
      type: 'template',
      template: '{{instruction}}',
      inputs: { instruction: { value: 'Exact static instruction' } },
    },
  ];

  assert.ok(
    validateWorkflow(workflowWith([block])).issues.some(
      ({ code }) => code === 'input_port_unbound',
    ),
  );
});

test('rejects malformed, duplicate, missing, and unknown invocation template placeholders', () => {
  const block = processBlock('invalid-template', [inputPort('known')], []);
  block.inputs[0]!.required = false;
  block.invocation.arguments = [
    {
      type: 'template',
      template: '{{missing}} {{duplicate}} {{duplicate}} {{bad name}} }}',
      inputs: {
        duplicate: { portId: 'known' },
        unused: { portId: 'missing-port' },
      },
    },
  ];

  const issues = validateWorkflow(workflowWith([block])).issues;
  const codes = issues.map(({ code }) => code);
  assert.ok(codes.includes('invocation_template_malformed_placeholder'));
  assert.ok(codes.includes('invocation_template_duplicate_placeholder'));
  assert.ok(codes.includes('invocation_template_missing_input'));
  assert.ok(codes.includes('invocation_template_unknown_input'));
  assert.ok(codes.includes('binding_references_missing_port'));
});

test('rejects multiple output bindings for the same port', () => {
  const block = processBlock('duplicate-binding', [], [outputPort('result')]);
  block.invocation.outputs = [
    { type: 'stdout', portId: 'result' },
    { type: 'stderr', portId: 'result' },
  ];
  const workflow = workflowWith([block]);

  const validation = validateWorkflow(workflow);

  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.issues.find(
      (issue) => issue.code === 'duplicate_output_binding',
    ),
    {
      code: 'duplicate_output_binding',
      message:
        'Output port "result" on block "duplicate-binding" has more than one output binding.',
      path: 'blocks[0].invocation.outputs[1]',
    },
  );
  assert.throws(
    () => createExecutionPlan(workflow),
    (error: unknown) => error instanceof InvalidWorkflowError,
  );
});

function workflowWith(
  blocks: ProcessBlock[],
  connections: WorkflowDefinition['connections'] = [],
): WorkflowDefinition {
  return {
    schemaVersion: 2,
    id: 'test-workflow',
    name: 'Test workflow',
    inputs: [],
    inputBindings: [],
    blocks,
    connections,
  };
}

function processBlock(
  id: string,
  inputs: InputPort[],
  outputs: OutputPort[],
): ProcessBlock {
  return {
    id,
    name: id,
    kind: 'process',
    inputs,
    outputs,
    invocation: {
      executable: 'fixture-command',
      arguments: inputs.map((input) => ({
        type: 'input' as const,
        portId: input.id,
      })),
      environment: {},
      shell: false,
      outputs: outputs.map((output) =>
        output.artifactKind === 'filesystem-reference'
          ? {
              type: 'filesystem' as const,
              portId: output.id,
              path: './fixture-output',
            }
          : { type: 'stdout' as const, portId: output.id },
      ),
    },
  };
}

function inputPort(id: string, artifactKind: ArtifactKind = 'text'): InputPort {
  return { id, name: id, artifactKind, required: true };
}

function outputPort(
  id: string,
  artifactKind: ArtifactKind = 'text',
): OutputPort {
  return { id, name: id, artifactKind };
}

function workflowInput(
  id: string,
  artifactKind: ArtifactKind,
  required: boolean,
): WorkflowInput {
  return { id, name: id, artifactKind, required };
}

function connection(
  id: string,
  sourceBlockId: string,
  sourcePortId: string,
  targetBlockId: string,
  targetPortId: string,
): WorkflowDefinition['connections'][number] {
  return {
    id,
    from: { blockId: sourceBlockId, portId: sourcePortId },
    to: { blockId: targetBlockId, portId: targetPortId },
  };
}
