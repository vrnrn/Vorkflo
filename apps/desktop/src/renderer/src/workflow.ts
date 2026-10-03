import type {
  ArtifactKind,
  BlockExecutionState,
  Connection,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorkflo/engine';
import type { ProcessFlowNode } from './ProcessNode';
import { getAgentBlockPresentation } from '../../shared/agent-runtime';
import { getComputerUseBlockPresentation } from '../../shared/computer-use-runtime';

export interface ProcessBlockClipboard {
  readonly block: ProcessBlock;
  readonly sourcePosition: { readonly x: number; readonly y: number };
}

export interface PasteProcessBlockOptions {
  readonly createId?: () => string;
  readonly offset?: { readonly x: number; readonly y: number };
  readonly position?: { readonly x: number; readonly y: number };
}

export interface PastedProcessBlock {
  readonly workflow: WorkflowDefinition;
  readonly blockId: string;
}

export interface AutoArrangeOptions {
  readonly origin?: { readonly x: number; readonly y: number };
  readonly columnGap?: number;
  readonly rowGap?: number;
}

export interface WorkflowHistory {
  readonly past: readonly WorkflowDefinition[];
  readonly present: WorkflowDefinition;
  readonly future: readonly WorkflowDefinition[];
  readonly limit: number;
}

const defaultPasteOffset = { x: 48, y: 48 } as const;
const defaultHistoryLimit = 50;

export function moveListItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const reordered = [...items];
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= reordered.length ||
    toIndex >= reordered.length
  ) {
    return reordered;
  }

  const [item] = reordered.splice(fromIndex, 1);
  if (item !== undefined) reordered.splice(toIndex, 0, item);
  return reordered;
}

export function moveRecordEntry<T>(
  record: Readonly<Record<string, T>>,
  fromIndex: number,
  toIndex: number,
): Record<string, T> {
  return Object.fromEntries(
    moveListItem(Object.entries(record), fromIndex, toIndex),
  );
}

/**
 * Captures an immutable clipboard snapshot. Connections are intentionally not
 * included because they describe relationships outside the copied block.
 */
export function copyProcessBlock(
  workflow: WorkflowDefinition,
  blockId: string,
): ProcessBlockClipboard | undefined {
  const index = workflow.blocks.findIndex((block) => block.id === blockId);
  const block = workflow.blocks[index];
  if (block === undefined) return undefined;

  const sourcePosition =
    workflow.layout?.blockPositions[blockId] ?? defaultBlockPosition(index);
  return {
    block: cloneProcessBlock(block),
    sourcePosition: { ...sourcePosition },
  };
}

/**
 * Pastes a detached block with a fresh workflow-scoped ID. Port IDs remain
 * stable because invocation bindings refer to them and port IDs are scoped to
 * their owning block.
 */
export function pasteProcessBlock(
  workflow: WorkflowDefinition,
  clipboard: ProcessBlockClipboard,
  options: PasteProcessBlockOptions = {},
): PastedProcessBlock {
  const blockId = freshBlockId(
    workflow,
    clipboard.block.id,
    options.createId ?? (() => crypto.randomUUID()),
  );
  const block = cloneProcessBlock(clipboard.block, blockId);
  const position = availablePastePosition(
    workflow,
    options.position ?? clipboard.sourcePosition,
    options.position === undefined
      ? (options.offset ?? defaultPasteOffset)
      : { x: 0, y: 0 },
  );

  return {
    blockId,
    workflow: {
      ...workflow,
      blocks: [...workflow.blocks, block],
      layout: {
        blockPositions: {
          ...(workflow.layout?.blockPositions ?? {}),
          [blockId]: position,
        },
      },
    },
  };
}

export function duplicateProcessBlock(
  workflow: WorkflowDefinition,
  blockId: string,
  options: PasteProcessBlockOptions = {},
): PastedProcessBlock | undefined {
  const clipboard = copyProcessBlock(workflow, blockId);
  return clipboard === undefined
    ? undefined
    : pasteProcessBlock(workflow, clipboard, options);
}

/**
 * Applies a deterministic left-to-right DAG layout only when explicitly
 * called. Blocks retain their workflow order within each dependency layer.
 */
export function autoArrangeWorkflow(
  workflow: WorkflowDefinition,
  options: AutoArrangeOptions = {},
): WorkflowDefinition {
  const origin = options.origin ?? { x: 160, y: 140 };
  const columnGap = options.columnGap ?? 360;
  const rowGap = options.rowGap ?? 240;
  const indexById = new Map(
    workflow.blocks.map((block, index) => [block.id, index]),
  );
  const indegree = new Map(workflow.blocks.map((block) => [block.id, 0]));
  const outgoing = new Map(
    workflow.blocks.map((block) => [block.id, [] as string[]]),
  );

  for (const connection of workflow.connections) {
    if (
      !indexById.has(connection.from.blockId) ||
      !indexById.has(connection.to.blockId)
    ) {
      continue;
    }
    outgoing.get(connection.from.blockId)?.push(connection.to.blockId);
    indegree.set(
      connection.to.blockId,
      (indegree.get(connection.to.blockId) ?? 0) + 1,
    );
  }
  for (const targets of outgoing.values()) {
    targets.sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );
  }

  const layerById = new Map(workflow.blocks.map((block) => [block.id, 0]));
  const ready = workflow.blocks
    .filter((block) => indegree.get(block.id) === 0)
    .map((block) => block.id);
  const processed = new Set<string>();

  while (ready.length > 0) {
    ready.sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );
    const blockId = ready.shift();
    if (blockId === undefined) break;
    processed.add(blockId);
    for (const targetId of outgoing.get(blockId) ?? []) {
      layerById.set(
        targetId,
        Math.max(
          layerById.get(targetId) ?? 0,
          (layerById.get(blockId) ?? 0) + 1,
        ),
      );
      const remaining = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) ready.push(targetId);
    }
  }

  // A workflow with a cycle is not runnable, but it can still exist while the
  // user is editing. Keep its unresolved nodes in a deterministic final layer.
  const highestLayer = Math.max(0, ...layerById.values());
  for (const block of workflow.blocks) {
    if (!processed.has(block.id)) layerById.set(block.id, highestLayer + 1);
  }

  const rowByLayer = new Map<number, number>();
  const blockPositions = Object.fromEntries(
    workflow.blocks.map((block) => {
      const layer = layerById.get(block.id) ?? 0;
      const row = rowByLayer.get(layer) ?? 0;
      rowByLayer.set(layer, row + 1);
      return [
        block.id,
        {
          x: origin.x + layer * columnGap,
          y: origin.y + row * rowGap,
        },
      ];
    }),
  );

  return { ...workflow, layout: { blockPositions } };
}

export function createWorkflowHistory(
  workflow: WorkflowDefinition,
  limit = defaultHistoryLimit,
): WorkflowHistory {
  return {
    past: [],
    present: workflow,
    future: [],
    limit: normalizeHistoryLimit(limit),
  };
}

export function pushWorkflowHistory(
  history: WorkflowHistory,
  workflow: WorkflowDefinition,
): WorkflowHistory {
  if (workflow === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-history.limit),
    present: workflow,
    future: [],
    limit: history.limit,
  };
}

export function undoWorkflowHistory(history: WorkflowHistory): WorkflowHistory {
  const present = history.past.at(-1);
  if (present === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
    limit: history.limit,
  };
}

export function redoWorkflowHistory(history: WorkflowHistory): WorkflowHistory {
  const present = history.future[0];
  if (present === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-history.limit),
    present,
    future: history.future.slice(1),
    limit: history.limit,
  };
}

export function reconcileProcessNodes(
  workflow: WorkflowDefinition,
  currentNodes: readonly ProcessFlowNode[],
  statusForBlock: (blockId: string) => BlockExecutionState | 'idle',
  options: { readonly applyLayout?: boolean } = {},
): ProcessFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return workflow.blocks.map((block, index) => {
    const current = currentById.get(block.id);
    const presentation = getAgentBlockPresentation(workflow, block.id);
    const computerUsePresentation = getComputerUseBlockPresentation(
      workflow,
      block.id,
    );
    return {
      ...current,
      id: block.id,
      type: 'process',
      position:
        (options.applyLayout
          ? (workflow.layout?.blockPositions[block.id] ?? current?.position)
          : (current?.position ?? workflow.layout?.blockPositions[block.id])) ??
        defaultBlockPosition(index),
      data: {
        block,
        status: statusForBlock(block.id),
        ...(presentation === undefined
          ? {}
          : { agentRuntime: presentation.agentRuntime }),
        ...(computerUsePresentation === undefined
          ? {}
          : { presentationKind: 'computer-use' as const }),
      },
    };
  });
}

export function setBlockPosition(
  workflow: WorkflowDefinition,
  blockId: string,
  position: { readonly x: number; readonly y: number },
): WorkflowDefinition {
  return {
    ...workflow,
    layout: {
      blockPositions: {
        ...(workflow.layout?.blockPositions ?? {}),
        [blockId]: position,
      },
    },
  };
}

export function replaceBlock(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
): WorkflowDefinition {
  return {
    ...workflow,
    blocks: workflow.blocks.map((candidate) =>
      candidate.id === block.id ? block : candidate,
    ),
  };
}

export function removeBlock(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  const positions = { ...(workflow.layout?.blockPositions ?? {}) };
  delete positions[blockId];
  return {
    ...workflow,
    blocks: workflow.blocks.filter((block) => block.id !== blockId),
    connections: workflow.connections.filter(
      (connection) =>
        connection.from.blockId !== blockId &&
        connection.to.blockId !== blockId,
    ),
    layout: { blockPositions: positions },
  };
}

export function connectBlocks(
  workflow: WorkflowDefinition,
  sourceBlockId: string,
  sourcePortId: string,
  targetBlockId: string,
  targetPortId: string,
): WorkflowDefinition {
  const connection: Connection = {
    id: crypto.randomUUID(),
    from: { blockId: sourceBlockId, portId: sourcePortId },
    to: { blockId: targetBlockId, portId: targetPortId },
  };
  return { ...workflow, connections: [...workflow.connections, connection] };
}

export function addInputPort(
  block: ProcessBlock,
  artifactKind: ArtifactKind = 'text',
): ProcessBlock {
  const id = uniquePortId(block, 'input');
  return {
    ...block,
    inputs: [...block.inputs, { id, name: id, artifactKind, required: true }],
    invocation: {
      ...block.invocation,
      arguments: [...block.invocation.arguments, { type: 'input', portId: id }],
    },
  };
}

export function addOutputPort(
  block: ProcessBlock,
  artifactKind: ArtifactKind = 'text',
): ProcessBlock {
  const id = uniquePortId(block, 'output');
  return {
    ...block,
    outputs: [...block.outputs, { id, name: id, artifactKind }],
    invocation: {
      ...block.invocation,
      outputs: [
        ...block.invocation.outputs,
        artifactKind === 'filesystem-reference'
          ? { type: 'filesystem' as const, portId: id, path: './output' }
          : { type: 'stdout' as const, portId: id },
      ],
    },
  };
}

export function removeInputPort(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  portId: string,
): WorkflowDefinition {
  return replaceBlock(
    {
      ...workflow,
      connections: workflow.connections.filter(
        (connection) =>
          !(
            connection.to.blockId === block.id &&
            connection.to.portId === portId
          ),
      ),
    },
    {
      ...block,
      inputs: block.inputs.filter((port) => port.id !== portId),
      invocation: {
        ...block.invocation,
        arguments: block.invocation.arguments.filter(
          (argument) =>
            !(
              (argument.type === 'input' && argument.portId === portId) ||
              (argument.type === 'template' &&
                Object.values(argument.inputs).some(
                  (binding) => 'portId' in binding && binding.portId === portId,
                ))
            ),
        ),
        environment: Object.fromEntries(
          Object.entries(block.invocation.environment).filter(
            ([, value]) =>
              !(value.source === 'input' && value.portId === portId),
          ),
        ),
        ...(block.invocation.stdin !== undefined &&
        (('portId' in block.invocation.stdin &&
          block.invocation.stdin.portId === portId) ||
          ('inputs' in block.invocation.stdin &&
            Object.values(block.invocation.stdin.inputs).some(
              (binding) => 'portId' in binding && binding.portId === portId,
            )))
          ? { stdin: undefined }
          : {}),
      },
    },
  );
}

export function removeOutputPort(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  portId: string,
): WorkflowDefinition {
  return replaceBlock(
    {
      ...workflow,
      connections: workflow.connections.filter(
        (connection) =>
          !(
            connection.from.blockId === block.id &&
            connection.from.portId === portId
          ),
      ),
    },
    {
      ...block,
      outputs: block.outputs.filter((port) => port.id !== portId),
      invocation: {
        ...block.invocation,
        outputs: block.invocation.outputs.filter(
          (binding) => binding.portId !== portId,
        ),
      },
    },
  );
}

function uniquePortId(block: ProcessBlock, prefix: string): string {
  const used = new Set([
    ...block.inputs.map((port) => port.id),
    ...block.outputs.map((port) => port.id),
  ]);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function cloneProcessBlock(block: ProcessBlock, id = block.id): ProcessBlock {
  return {
    ...block,
    id,
    inputs: block.inputs.map((port) => ({ ...port })),
    outputs: block.outputs.map((port) => ({ ...port })),
    invocation: {
      ...block.invocation,
      arguments: block.invocation.arguments.map((argument) => ({
        ...argument,
      })),
      environment: Object.fromEntries(
        Object.entries(block.invocation.environment).map(([name, value]) => [
          name,
          { ...value },
        ]),
      ),
      ...(block.invocation.stdin === undefined
        ? {}
        : { stdin: { ...block.invocation.stdin } }),
      outputs: block.invocation.outputs.map((output) => ({ ...output })),
    },
  };
}

function freshBlockId(
  workflow: WorkflowDefinition,
  sourceBlockId: string,
  createId: () => string,
): string {
  const used = new Set(workflow.blocks.map((block) => block.id));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = createId().trim();
    if (candidate !== '' && !used.has(candidate)) return candidate;
  }

  const base = `${sourceBlockId}-copy`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function availablePastePosition(
  workflow: WorkflowDefinition,
  source: { readonly x: number; readonly y: number },
  offset: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const exactPosition = offset.x === 0 && offset.y === 0;
  const displacement = exactPosition ? defaultPasteOffset : offset;
  const occupied = new Set(
    Object.values(workflow.layout?.blockPositions ?? {}).map(
      (position) => `${position.x}:${position.y}`,
    ),
  );
  let multiplier = exactPosition ? 0 : 1;
  while (true) {
    const position = {
      x: source.x + displacement.x * multiplier,
      y: source.y + displacement.y * multiplier,
    };
    if (!occupied.has(`${position.x}:${position.y}`)) return position;
    multiplier += 1;
  }
}

function normalizeHistoryLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
}

function defaultBlockPosition(index: number): { x: number; y: number } {
  return {
    x: 160 + (index % 3) * 310,
    y: 140 + Math.floor(index / 3) * 240,
  };
}
