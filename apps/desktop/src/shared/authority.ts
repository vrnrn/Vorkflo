import {
  parseWorkflowDefinition,
  validateWorkflow,
  type WorkflowDefinition,
} from '@vorkflo/engine';

/** Parse and semantically validate at the process-authority boundary. */
export function parseRunnableWorkflow(input: unknown): WorkflowDefinition {
  const workflow = parseWorkflowDefinition(input);
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    const summary = validation.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
    throw new Error(`Workflow is not runnable:\n${summary}`);
  }
  return workflow;
}
