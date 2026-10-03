import type { ProcessBlock, WorkflowDefinition } from '@vorkflo/engine';

export function createProcessBlock(
  id: string = crypto.randomUUID(),
  name = 'Untitled process',
): ProcessBlock {
  return {
    id,
    name,
    kind: 'process',
    inputs: [],
    outputs: [
      {
        id: 'stdout',
        name: 'stdout',
        artifactKind: 'text',
      },
    ],
    invocation: {
      executable: 'printf',
      arguments: [{ type: 'literal', value: 'Hello from Vorkflo\\n' }],
      environment: {
        PATH: { source: 'host', name: 'PATH' },
      },
      shell: false,
      outputs: [{ type: 'stdout', portId: 'stdout' }],
    },
  };
}

export function createWorkflow(): WorkflowDefinition {
  const block = createProcessBlock('welcome', 'Welcome');
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: 'Untitled workflow',
    inputs: [],
    inputBindings: [],
    blocks: [block],
    connections: [],
    layout: {
      blockPositions: {
        [block.id]: { x: 180, y: 160 },
      },
    },
  };
}
