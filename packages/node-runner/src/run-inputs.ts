import {
  canonicalizeWorkflowRunInputs,
  type WorkflowDefinition,
  type WorkflowRunInputs,
} from '@vorkflo/engine';

import { resolveProcessFilesystemPath } from './path-resolution.js';

/** Resolve run-local filesystem values without changing portable workflow data. */
export function canonicalizeNodeWorkflowRunInputs(
  workflow: WorkflowDefinition,
  runInputs: WorkflowRunInputs | undefined,
  baseDirectory: string = process.cwd(),
): WorkflowRunInputs {
  return canonicalizeWorkflowRunInputs(workflow, runInputs, (path) =>
    resolveProcessFilesystemPath(path, undefined, baseDirectory),
  );
}
