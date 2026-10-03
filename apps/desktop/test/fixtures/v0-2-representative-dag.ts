import type {
  Connection,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorkflo/engine';

/**
 * The deterministic workflow used by v0.2 editor performance acceptance.
 *
 * It is deliberately larger and less linear than the product examples:
 * eight sources fan out, sixteen transforms remain parallel, and later layers
 * fan in through multi-input blocks. No process from this fixture is executed
 * by the performance tests.
 */
export function createV02RepresentativeDag(): WorkflowDefinition {
  const layerSizes = [8, 16, 16, 8, 2, 1] as const;
  const blocks = layerSizes.flatMap((size, layerIndex) =>
    Array.from({ length: size }, (_, nodeIndex) =>
      createBlock(
        blockId(layerIndex, nodeIndex),
        layerIndex === 0
          ? 0
          : layerIndex === 3
            ? 2
            : layerIndex === 4
              ? 4
              : layerIndex === 5
                ? 2
                : 1,
        layerIndex < layerSizes.length - 1,
      ),
    ),
  );
  const connections: Connection[] = [];

  // Eight sources each fan out to two transforms.
  for (let target = 0; target < layerSizes[1]; target += 1) {
    connections.push(
      connect(0, Math.floor(target / 2), 1, target, 0, connections.length),
    );
  }

  // A full-width parallel transform layer.
  for (let index = 0; index < layerSizes[2]; index += 1) {
    connections.push(connect(1, index, 2, index, 0, connections.length));
  }

  // Pair sixteen branches into eight two-input aggregators.
  for (let source = 0; source < layerSizes[2]; source += 1) {
    connections.push(
      connect(
        2,
        source,
        3,
        Math.floor(source / 2),
        source % 2,
        connections.length,
      ),
    );
  }

  // Fold eight branches into two four-input aggregators.
  for (let source = 0; source < layerSizes[3]; source += 1) {
    connections.push(
      connect(
        3,
        source,
        4,
        Math.floor(source / 4),
        source % 4,
        connections.length,
      ),
    );
  }

  // Join both branches at the final sink.
  for (let source = 0; source < layerSizes[4]; source += 1) {
    connections.push(connect(4, source, 5, 0, source, connections.length));
  }

  return {
    schemaVersion: 2,
    id: 'v0-2-representative-performance-dag',
    name: 'v0.2 representative performance DAG',
    inputs: [],
    inputBindings: [],
    blocks,
    connections,
    layout: {
      blockPositions: Object.fromEntries(
        layerSizes.flatMap((size, layerIndex) =>
          Array.from({ length: size }, (_, nodeIndex) => [
            blockId(layerIndex, nodeIndex),
            { x: 160 + layerIndex * 360, y: 140 + nodeIndex * 220 },
          ]),
        ),
      ),
    },
    editor: {
      acceptanceFixture: 'v0.2-performance',
    },
  };
}

export const v02RepresentativeDagShape = {
  layerSizes: [8, 16, 16, 8, 2, 1],
  blockCount: 51,
  connectionCount: 58,
} as const;

function createBlock(
  id: string,
  inputCount: number,
  producesOutput: boolean,
): ProcessBlock {
  const inputs = Array.from({ length: inputCount }, (_, index) => ({
    id: `input-${index + 1}`,
    name: `input-${index + 1}`,
    artifactKind: 'text' as const,
    required: true,
  }));
  const outputs = producesOutput
    ? [
        {
          id: 'stdout',
          name: 'stdout',
          artifactKind: 'text' as const,
        },
      ]
    : [];

  return {
    id,
    name: `Performance block ${id}`,
    kind: 'process',
    inputs,
    outputs,
    invocation: {
      executable: 'printf',
      arguments:
        inputs.length === 0
          ? [{ type: 'literal', value: `${id}\\n` }]
          : inputs.map((input) => ({
              type: 'input' as const,
              portId: input.id,
            })),
      environment: {
        PATH: { source: 'host', name: 'PATH' },
      },
      shell: false,
      outputs: producesOutput ? [{ type: 'stdout', portId: 'stdout' }] : [],
    },
  };
}

function connect(
  sourceLayer: number,
  sourceIndex: number,
  targetLayer: number,
  targetIndex: number,
  targetPortIndex: number,
  connectionIndex: number,
): Connection {
  return {
    id: `connection-${connectionIndex + 1}`,
    from: {
      blockId: blockId(sourceLayer, sourceIndex),
      portId: 'stdout',
    },
    to: {
      blockId: blockId(targetLayer, targetIndex),
      portId: `input-${targetPortIndex + 1}`,
    },
  };
}

function blockId(layerIndex: number, nodeIndex: number): string {
  return `layer-${layerIndex + 1}-block-${nodeIndex + 1}`;
}
