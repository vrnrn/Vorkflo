import type { WorkflowDefinition } from './schema.js';
import { validateWorkflow, type ValidationIssue } from './validation.js';

export interface ExecutionPlan {
  readonly workflowId: string;
  readonly layers: readonly (readonly string[])[];
}

export class InvalidWorkflowError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      `Workflow is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
    );
    this.name = 'InvalidWorkflowError';
    this.issues = issues;
  }
}

export function createExecutionPlan(
  workflow: WorkflowDefinition,
): ExecutionPlan {
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    throw new InvalidWorkflowError(validation.issues);
  }

  const order = new Map(
    workflow.blocks.map((block, index) => [block.id, index] as const),
  );
  const inDegree = new Map<string, number>(
    workflow.blocks.map((block) => [block.id, 0] as const),
  );
  const outgoing = new Map(
    workflow.blocks.map((block) => [block.id, [] as string[]] as const),
  );

  for (const connection of workflow.connections) {
    outgoing.get(connection.from.blockId)?.push(connection.to.blockId);
    inDegree.set(
      connection.to.blockId,
      (inDegree.get(connection.to.blockId) ?? 0) + 1,
    );
  }

  let currentLayer = workflow.blocks
    .filter((block) => inDegree.get(block.id) === 0)
    .map((block) => block.id);
  const layers: string[][] = [];

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    const nextLayer = new Set<string>();

    for (const blockId of currentLayer) {
      for (const targetId of outgoing.get(blockId) ?? []) {
        const nextDegree = (inDegree.get(targetId) ?? 0) - 1;
        inDegree.set(targetId, nextDegree);
        if (nextDegree === 0) {
          nextLayer.add(targetId);
        }
      }
    }

    currentLayer = [...nextLayer].sort(
      (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
  }

  return { workflowId: workflow.id, layers };
}
