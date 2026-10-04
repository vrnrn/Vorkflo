import { describe, expect, it } from 'vitest';
import {
  validateWorkflow,
  type ProcessBlock,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import { createProcessBlock, createWorkflow } from '../src/shared/defaults';
import { setAgentBlockPresentation } from '../src/shared/agent-runtime';
import { parseRunnableWorkflow } from '../src/shared/authority';
import {
  addInputPort,
  addOutputPort,
  autoArrangeWorkflow,
  connectBlocks,
  copyProcessBlock,
  createWorkflowHistory,
  duplicateProcessBlock,
  moveListItem,
  moveRecordEntry,
  pasteProcessBlock,
  reconcileProcessNodes,
  redoWorkflowHistory,
  removeBlock,
  removeInputPort,
  removeOutputPort,
  setBlockPosition,
  pushWorkflowHistory,
  undoWorkflowHistory,
} from '../src/renderer/src/workflow';

describe('desktop workflow editing', () => {
  it('removes workflow-input bindings when deleting their block or input port', () => {
    const consumer = addInputPort(createProcessBlock('consumer'));
    const other = addInputPort(createProcessBlock('other'));
    const workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [consumer, other],
      inputs: [
        { id: 'text', name: 'Text', artifactKind: 'text', required: true },
      ],
      inputBindings: [consumer, other].map((block) => ({
        id: block.id,
        inputId: 'text',
        to: { blockId: block.id, portId: block.inputs[0]!.id },
      })),
    };
    for (const next of [
      removeBlock(workflow, consumer.id),
      removeInputPort(workflow, consumer, consumer.inputs[0]!.id),
    ]) {
      expect(next.inputBindings).toEqual([workflow.inputBindings[1]]);
      expect(validateWorkflow(next).valid).toBe(true);
    }
    expect(workflow.inputBindings).toHaveLength(2);
  });

  it('copies nested invocation templates independently of the source and each paste', () => {
    const block = createProcessBlock('source');
    block.invocation.arguments = [
      {
        type: 'template',
        template: '{{message}}',
        inputs: { message: { value: 'original' } },
      },
    ];
    block.invocation.stdin = {
      template: '{{message}}',
      inputs: { message: { value: 'stdin' } },
    };
    const workflow = { ...createWorkflow(), blocks: [block] };
    const clipboard = copyProcessBlock(workflow, block.id)!;
    const pasted = pasteProcessBlock(workflow, clipboard, {
      createId: () => 'copy',
    }).workflow.blocks[1]!;
    const original = block.invocation.arguments[0]!;
    if (original.type !== 'template') throw new Error('Expected template');
    original.inputs.message = { value: 'changed' };
    expect(clipboard.block.invocation.arguments[0]).toMatchObject({
      inputs: { message: { value: 'original' } },
    });
    expect(pasted.invocation.arguments[0]).toMatchObject({
      inputs: { message: { value: 'original' } },
    });
    expect(pasted.invocation.stdin).not.toBe(clipboard.block.invocation.stdin);
    if (
      pasted.invocation.stdin !== undefined &&
      'inputs' in pasted.invocation.stdin &&
      clipboard.block.invocation.stdin !== undefined &&
      'inputs' in clipboard.block.invocation.stdin
    ) {
      expect(pasted.invocation.stdin.inputs).not.toBe(
        clipboard.block.invocation.stdin.inputs,
      );
    }
  });
  it('applies an explicit layout without discarding node measurements or selection', () => {
    const workflow = createWorkflow();
    const current = reconcileProcessNodes(workflow, [], () => 'idle').map(
      (node) => ({
        ...node,
        selected: true,
        measured: { width: 240, height: 110 },
        position: { x: 900, y: 900 },
      }),
    );
    const arranged = autoArrangeWorkflow(workflow);
    const next = reconcileProcessNodes(arranged, current, () => 'idle', {
      applyLayout: true,
    });
    expect(next[0]!.position).toEqual(
      arranged.layout!.blockPositions[next[0]!.id],
    );
    expect(next[0]!.measured).toBe(current[0]!.measured);
    expect(next[0]!.selected).toBe(true);
    expect(current[0]!.position).toEqual({ x: 900, y: 900 });
    expect(
      reconcileProcessNodes(arranged, current, () => 'idle')[0]!.position,
    ).toBe(current[0]!.position);
  });
  it('reorders invocation items without mutating the original list', () => {
    const original = ['first', 'input:prompt', 'last'];

    expect(moveListItem(original, 1, 0)).toEqual([
      'input:prompt',
      'first',
      'last',
    ]);
    expect(original).toEqual(['first', 'input:prompt', 'last']);
    expect(moveListItem(original, 0, 2)).toEqual([
      'input:prompt',
      'last',
      'first',
    ]);
    expect(moveListItem(original, 0, 3)).toEqual(original);
  });

  it('reorders environment entries while preserving their values', () => {
    const environment = {
      PATH: { source: 'host' as const, name: 'PATH' },
      MODE: { source: 'literal' as const, value: 'safe' },
      HOME: { source: 'host' as const, name: 'HOME' },
    };

    const reordered = moveRecordEntry(environment, 2, 0);

    expect(Object.keys(reordered)).toEqual(['HOME', 'PATH', 'MODE']);
    expect(reordered).toEqual({
      HOME: { source: 'host', name: 'HOME' },
      PATH: { source: 'host', name: 'PATH' },
      MODE: { source: 'literal', value: 'safe' },
    });
    expect(Object.keys(environment)).toEqual(['PATH', 'MODE', 'HOME']);
  });

  it('copies and pastes detached block configuration with fresh IDs', () => {
    const block = configuredBlock();
    const workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [block],
      connections: [],
      layout: { blockPositions: { source: { x: 10, y: 20 } } },
    };
    const clipboard = copyProcessBlock(workflow, 'source');
    expect(clipboard).toBeDefined();

    const first = pasteProcessBlock(workflow, clipboard!, {
      createId: () => 'source',
    });
    const second = pasteProcessBlock(first.workflow, clipboard!, {
      createId: () => 'source',
    });
    const pasted = first.workflow.blocks.at(-1)!;

    expect(first.blockId).toBe('source-copy');
    expect(second.blockId).toBe('source-copy-2');
    expect(first.workflow.layout?.blockPositions[first.blockId]).toEqual({
      x: 58,
      y: 68,
    });
    expect(second.workflow.layout?.blockPositions[second.blockId]).toEqual({
      x: 106,
      y: 116,
    });
    expect(pasted).toEqual({ ...block, id: first.blockId });
    expect(pasted).not.toBe(block);
    expect(pasted.inputs).not.toBe(block.inputs);
    expect(pasted.invocation.arguments).not.toBe(block.invocation.arguments);
    expect(Object.keys(pasted.invocation.environment)).toEqual([
      'PATH',
      'MODE',
    ]);
    expect(first.workflow.connections).toEqual([]);
    expect(validateWorkflow(first.workflow)).toEqual({
      valid: true,
      issues: [],
    });

    const pastedAtPointer = pasteProcessBlock(workflow, clipboard!, {
      createId: () => 'pointer-paste',
      position: { x: 320, y: 240 },
    });
    expect(
      pastedAtPointer.workflow.layout?.blockPositions[pastedAtPointer.blockId],
    ).toEqual({ x: 320, y: 240 });
  });

  it('duplicates a block through the same fresh-ID paste contract', () => {
    const workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [configuredBlock()],
      connections: [],
    };

    const duplicate = duplicateProcessBlock(workflow, 'source', {
      createId: () => 'duplicate',
      offset: { x: 25, y: 30 },
    });

    expect(duplicate?.blockId).toBe('duplicate');
    expect(duplicate?.workflow.blocks.map((block) => block.id)).toEqual([
      'source',
      'duplicate',
    ]);
    expect(duplicate?.workflow.layout?.blockPositions.duplicate).toEqual({
      x: 185,
      y: 170,
    });
    expect(duplicateProcessBlock(workflow, 'missing')).toBeUndefined();
  });

  it('auto-arranges dependency layers deterministically when requested', () => {
    const source = createProcessBlock('source');
    const free = createProcessBlock('free');
    const left = addInputPort(createProcessBlock('left'));
    const right = addInputPort(createProcessBlock('right'));
    const join = addInputPort(addInputPort(createProcessBlock('join')));
    const workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [join, right, source, left, free],
      connections: [
        connection('source-left', 'source', 'left', left.inputs[0]!.id),
        connection('source-right', 'source', 'right', right.inputs[0]!.id),
        connection('left-join', 'left', 'join', join.inputs[0]!.id),
        connection('right-join', 'right', 'join', join.inputs[1]!.id),
      ],
    };

    const arranged = autoArrangeWorkflow(workflow, {
      origin: { x: 100, y: 50 },
      columnGap: 250,
      rowGap: 100,
    });

    expect(arranged.layout?.blockPositions).toEqual({
      join: { x: 600, y: 50 },
      right: { x: 350, y: 50 },
      source: { x: 100, y: 50 },
      left: { x: 350, y: 150 },
      free: { x: 100, y: 150 },
    });
    expect(
      autoArrangeWorkflow(workflow, {
        origin: { x: 100, y: 50 },
        columnGap: 250,
        rowGap: 100,
      }).layout,
    ).toEqual(arranged.layout);
    expect(workflow.layout).toEqual(createWorkflow().layout);
  });

  it('keeps a bounded pure undo/redo history and clears redo on a new edit', () => {
    const initial = createWorkflow();
    const renamed = { ...initial, name: 'Renamed' };
    const expanded = {
      ...renamed,
      blocks: [...renamed.blocks, createProcessBlock('second')],
    };
    const final = { ...expanded, name: 'Final' };
    let history = createWorkflowHistory(initial, 2);

    history = pushWorkflowHistory(history, renamed);
    history = pushWorkflowHistory(history, expanded);
    history = pushWorkflowHistory(history, final);
    expect(history.past.map((workflow) => workflow.name)).toEqual([
      'Renamed',
      'Renamed',
    ]);
    expect(history.past[0]?.blocks).toHaveLength(1);
    expect(history.past[1]?.blocks).toHaveLength(2);

    history = undoWorkflowHistory(history);
    expect(history.present).toBe(expanded);
    expect(history.future).toEqual([final]);
    history = undoWorkflowHistory(history);
    expect(history.present).toBe(renamed);
    history = redoWorkflowHistory(history);
    expect(history.present).toBe(expanded);

    const alternate = { ...expanded, name: 'Alternate' };
    history = pushWorkflowHistory(history, alternate);
    expect(history.future).toEqual([]);
    expect(pushWorkflowHistory(history, history.present)).toBe(history);
    expect(initial.name).toBe('Untitled workflow');
  });

  it('keeps transient drag position while workflow data and status update', () => {
    const workflow = createWorkflow();
    const initial = reconcileProcessNodes(workflow, [], () => 'idle');
    const dragging = initial.map((node) => ({
      ...node,
      position: { x: 740, y: 510 },
      dragging: true,
    }));
    const renamed: WorkflowDefinition = {
      ...workflow,
      blocks: workflow.blocks.map((block) => ({
        ...block,
        name: 'Renamed while dragging',
      })),
    };

    const reconciled = reconcileProcessNodes(
      renamed,
      dragging,
      () => 'running',
    );

    expect(reconciled[0]).toMatchObject({
      position: { x: 740, y: 510 },
      dragging: true,
      data: {
        status: 'running',
        block: { name: 'Renamed while dragging' },
      },
    });
  });

  it('projects explicit AI Agent editor identity without executable inference', () => {
    const workflow = setAgentBlockPresentation(
      createWorkflow(),
      'welcome',
      'codex',
    );

    expect(reconcileProcessNodes(workflow, [], () => 'idle')[0]?.data).toEqual(
      expect.objectContaining({
        agentRuntime: 'codex',
        block: expect.objectContaining({
          invocation: expect.objectContaining({ executable: 'printf' }),
        }),
      }),
    );
  });

  it('persists a final drag position without disturbing other layout entries', () => {
    const workflow = createWorkflow();
    const next = setBlockPosition(workflow, 'welcome', { x: 920, y: 340 });

    expect(next.layout?.blockPositions.welcome).toEqual({ x: 920, y: 340 });
    expect(workflow.layout?.blockPositions.welcome).toEqual({ x: 180, y: 160 });
  });

  it('creates a runnable starter workflow with explicit PATH authority', () => {
    const workflow = createWorkflow();

    expect(validateWorkflow(workflow)).toEqual({ valid: true, issues: [] });
    expect(workflow.blocks[0]?.invocation.environment).toEqual({
      PATH: { source: 'host', name: 'PATH' },
    });
    expect(workflow.layout?.blockPositions.welcome).toEqual({ x: 180, y: 160 });
  });

  it('adds ports together with valid invocation bindings', () => {
    const initial = createProcessBlock('producer');
    const withInput = addInputPort(initial, 'json');
    const withOutput = addOutputPort(withInput, 'filesystem-reference');

    expect(withOutput.inputs[0]).toMatchObject({
      artifactKind: 'json',
      required: true,
    });
    expect(withOutput.invocation.arguments).toContainEqual({
      type: 'input',
      portId: withOutput.inputs[0]?.id,
    });
    expect(withOutput.invocation.outputs.at(-1)).toMatchObject({
      type: 'filesystem',
      portId: withOutput.outputs.at(-1)?.id,
    });
  });

  it('removes block connections and persisted layout atomically', () => {
    const upstream = createProcessBlock('upstream');
    const downstream = addInputPort(createProcessBlock('downstream'));
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [upstream, downstream],
      layout: {
        blockPositions: {
          upstream: { x: 10, y: 20 },
          downstream: { x: 300, y: 20 },
        },
      },
    };
    workflow = connectBlocks(
      workflow,
      'upstream',
      'stdout',
      'downstream',
      downstream.inputs[0]!.id,
    );

    const next = removeBlock(workflow, 'upstream');

    expect(next.blocks.map((block) => block.id)).toEqual(['downstream']);
    expect(next.connections).toHaveLength(0);
    expect(next.layout?.blockPositions).not.toHaveProperty('upstream');
  });

  it('removes port connections and process bindings together', () => {
    const upstream = createProcessBlock('upstream');
    const downstream = addInputPort(createProcessBlock('downstream'));
    const inputId = downstream.inputs[0]!.id;
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [upstream, downstream],
    };
    workflow = connectBlocks(
      workflow,
      'upstream',
      'stdout',
      'downstream',
      inputId,
    );

    const withoutInput = removeInputPort(workflow, downstream, inputId);
    const withoutOutput = removeOutputPort(withoutInput, upstream, 'stdout');

    expect(withoutInput.connections).toHaveLength(0);
    expect(withoutInput.blocks[1]?.invocation.arguments).not.toContainEqual({
      type: 'input',
      portId: inputId,
    });
    expect(withoutOutput.blocks[0]?.outputs).toHaveLength(0);
    expect(withoutOutput.blocks[0]?.invocation.outputs).toHaveLength(0);
  });

  it('leaves cycle detection to the canonical engine validation', () => {
    const first = addInputPort(createProcessBlock('first'));
    const second = addInputPort(createProcessBlock('second'));
    let workflow: WorkflowDefinition = {
      ...createWorkflow(),
      blocks: [first, second],
      connections: [],
    };
    workflow = connectBlocks(
      workflow,
      'first',
      'stdout',
      'second',
      second.inputs[0]!.id,
    );
    workflow = connectBlocks(
      workflow,
      'second',
      'stdout',
      'first',
      first.inputs[0]!.id,
    );

    expect(validateWorkflow(workflow).issues).toContainEqual(
      expect.objectContaining({ code: 'cycle_detected' }),
    );
    expect(() => parseRunnableWorkflow(workflow)).toThrow(
      /Workflow is not runnable:[\s\S]*directed acyclic graph/,
    );
  });
});

function configuredBlock(): ProcessBlock {
  return {
    id: 'source',
    name: 'Configured process',
    kind: 'process',
    inputs: [
      {
        id: 'prompt',
        name: 'Prompt',
        artifactKind: 'text',
        required: false,
      },
      {
        id: 'context',
        name: 'Context',
        artifactKind: 'text',
        required: false,
      },
    ],
    outputs: [
      { id: 'stdout', name: 'Response', artifactKind: 'text' },
      { id: 'report', name: 'Report', artifactKind: 'filesystem-reference' },
    ],
    invocation: {
      executable: 'tool',
      arguments: [
        { type: 'literal', value: '--mode' },
        { type: 'input', portId: 'context' },
        { type: 'literal', value: 'safe' },
      ],
      workingDirectory: '/workspace',
      environment: {
        PATH: { source: 'host', name: 'PATH' },
        MODE: { source: 'literal', value: 'test' },
      },
      stdin: { portId: 'prompt' },
      shell: false,
      outputs: [
        { type: 'stdout', portId: 'stdout' },
        {
          type: 'filesystem',
          portId: 'report',
          path: './report.txt',
          entity: 'file',
        },
      ],
    },
  };
}

function connection(
  id: string,
  fromBlockId: string,
  toBlockId: string,
  toPortId: string,
): WorkflowDefinition['connections'][number] {
  return {
    id,
    from: { blockId: fromBlockId, portId: 'stdout' },
    to: { blockId: toBlockId, portId: toPortId },
  };
}
