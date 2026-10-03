import type { Artifact } from './artifact.js';
import {
  workflowRunInputsSchema,
  type WorkflowDefinition,
  type WorkflowRunInputs,
  type WorkflowRunInputValue,
} from './schema.js';

export type RunInputIssueCode =
  | 'invalid_run_inputs'
  | 'unknown_run_input'
  | 'missing_required_run_input'
  | 'run_input_kind_mismatch';

export interface RunInputIssue {
  readonly code: RunInputIssueCode;
  readonly message: string;
  readonly path: string;
  readonly inputId?: string;
}

export interface RunInputValidationResult {
  readonly valid: boolean;
  readonly issues: readonly RunInputIssue[];
}

export class InvalidRunInputsError extends Error {
  readonly issues: readonly RunInputIssue[];

  constructor(issues: readonly RunInputIssue[]) {
    super(
      `Workflow run inputs are invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
    );
    this.name = 'InvalidRunInputsError';
    this.issues = issues;
  }
}

export interface ResolvedWorkflowRunInput {
  readonly value: WorkflowRunInputValue;
  readonly valueSource: 'supplied' | 'default';
}

export type WorkflowFilesystemPathCanonicalizer = (
  path: string,
  inputId: string,
) => string;

export function validateWorkflowRunInputs(
  workflow: WorkflowDefinition,
  input: unknown,
): RunInputValidationResult {
  return prepareWorkflowRunInputs(workflow, input).validation;
}

export function resolveWorkflowRunInputArtifacts(
  workflow: WorkflowDefinition,
  input: unknown,
  runId: string,
  createdAt: string,
): ReadonlyMap<string, Artifact> {
  const effective = resolveWorkflowRunInputValues(workflow, input);

  const artifacts = new Map<string, Artifact>();
  for (const [inputId, resolved] of effective.entries()) {
    const provenance = {
      source: 'workflow-input' as const,
      runId,
      inputId,
      createdAt,
      valueSource: resolved.valueSource,
    };
    const id = JSON.stringify([runId, 'workflow-input', inputId]);
    const value = resolved.value;
    if (value.kind === 'text') {
      artifacts.set(inputId, {
        id,
        kind: 'text',
        value: value.value,
        provenance,
      });
    } else if (value.kind === 'json') {
      artifacts.set(inputId, {
        id,
        kind: 'json',
        value: value.value,
        provenance,
      });
    } else {
      artifacts.set(inputId, {
        id,
        kind: 'filesystem-reference',
        path: value.path,
        entity: value.entity ?? 'unknown',
        provenance,
      });
    }
  }
  return artifacts;
}

export function resolveWorkflowRunInputValues(
  workflow: WorkflowDefinition,
  input: unknown,
): ReadonlyMap<string, ResolvedWorkflowRunInput> {
  const prepared = prepareWorkflowRunInputs(workflow, input);
  if (!prepared.validation.valid) {
    throw new InvalidRunInputsError(prepared.validation.issues);
  }
  return prepared.effective;
}

/**
 * Materializes supplied values and explicit defaults into one run-local input
 * record while allowing the host to canonicalize machine-local filesystem
 * paths. The portable workflow and caller-owned input record are never mutated.
 */
export function canonicalizeWorkflowRunInputs(
  workflow: WorkflowDefinition,
  input: unknown,
  canonicalizeFilesystemPath: WorkflowFilesystemPathCanonicalizer,
): WorkflowRunInputs {
  const canonical = Object.create(null) as WorkflowRunInputs;
  for (const [inputId, resolved] of resolveWorkflowRunInputValues(
    workflow,
    input,
  )) {
    const value = resolved.value;
    canonical[inputId] =
      value.kind === 'filesystem-reference'
        ? {
            ...value,
            path: canonicalizeFilesystemPath(value.path, inputId),
          }
        : value;
  }
  return canonical;
}

function prepareWorkflowRunInputs(
  workflow: WorkflowDefinition,
  input: unknown,
): {
  readonly validation: RunInputValidationResult;
  readonly effective: ReadonlyMap<string, ResolvedWorkflowRunInput>;
} {
  const parsed = workflowRunInputsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      validation: {
        valid: false,
        issues: parsed.error.issues.map((issue) => ({
          code: 'invalid_run_inputs',
          message: issue.message,
          path: formatRunInputPath(issue.path),
        })),
      },
      effective: new Map(),
    };
  }

  const supplied = parsed.data as WorkflowRunInputs;
  const issues: RunInputIssue[] = [];
  const effective = new Map<string, ResolvedWorkflowRunInput>();
  const definitions = new Map(
    workflow.inputs.map((definition) => [definition.id, definition] as const),
  );

  for (const inputId of Object.keys(supplied)) {
    if (!definitions.has(inputId)) {
      issues.push({
        code: 'unknown_run_input',
        message: `Run input "${inputId}" is not declared by workflow "${workflow.id}".`,
        path: `runInputs.${inputId}`,
        inputId,
      });
    }
  }

  const requiredInputIds = collectRequiredWorkflowInputIds(workflow);
  for (const definition of workflow.inputs) {
    const suppliedValue = supplied[definition.id];
    const effectiveValue =
      suppliedValue === undefined ? definition.defaultValue : suppliedValue;
    if (effectiveValue === undefined) {
      if (requiredInputIds.has(definition.id)) {
        issues.push({
          code: 'missing_required_run_input',
          message: `Required workflow input "${definition.id}" has no supplied or explicitly serialized default value.`,
          path: `runInputs.${definition.id}`,
          inputId: definition.id,
        });
      }
      continue;
    }
    if (effectiveValue.kind !== definition.artifactKind) {
      issues.push({
        code: 'run_input_kind_mismatch',
        message: `Run input "${definition.id}" has kind "${effectiveValue.kind}", but the workflow declares "${definition.artifactKind}".`,
        path: `runInputs.${definition.id}`,
        inputId: definition.id,
      });
      continue;
    }
    effective.set(definition.id, {
      value: effectiveValue,
      valueSource: suppliedValue === undefined ? 'default' : 'supplied',
    });
  }

  return {
    validation: { valid: issues.length === 0, issues },
    effective,
  };
}

function collectRequiredWorkflowInputIds(
  workflow: WorkflowDefinition,
): ReadonlySet<string> {
  const required = new Set(
    workflow.inputs.filter((input) => input.required).map((input) => input.id),
  );
  const blocks = new Map(workflow.blocks.map((block) => [block.id, block]));
  for (const binding of workflow.inputBindings) {
    const port = blocks
      .get(binding.to.blockId)
      ?.inputs.find((input) => input.id === binding.to.portId);
    if (port?.required === true) required.add(binding.inputId);
  }
  return required;
}

function formatRunInputPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'runInputs';
  return `runInputs.${path.map(String).join('.')}`;
}
