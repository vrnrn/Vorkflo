import {
  validateWorkflowRunInputs,
  type ArtifactKind,
  type JsonValue,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowRunInputs,
  type WorkflowRunInputValue,
} from '@vorkflo/engine';

export function addWorkflowInput(
  workflow: WorkflowDefinition,
  artifactKind: ArtifactKind = 'text',
): { readonly workflow: WorkflowDefinition; readonly inputId: string } {
  const inputId = uniqueWorkflowInputId(workflow);
  const input: WorkflowInput = {
    id: inputId,
    name: inputId,
    artifactKind,
    required: true,
  };
  return {
    inputId,
    workflow: { ...workflow, inputs: [...workflow.inputs, input] },
  };
}

export function updateWorkflowInput(
  workflow: WorkflowDefinition,
  input: WorkflowInput,
): WorkflowDefinition {
  return {
    ...workflow,
    inputs: workflow.inputs.map((candidate) =>
      candidate.id === input.id ? input : candidate,
    ),
  };
}

export function removeWorkflowInput(
  workflow: WorkflowDefinition,
  inputId: string,
): WorkflowDefinition {
  return {
    ...workflow,
    inputs: workflow.inputs.filter((input) => input.id !== inputId),
    inputBindings: workflow.inputBindings.filter(
      (binding) => binding.inputId !== inputId,
    ),
  };
}

export function bindWorkflowInput(
  workflow: WorkflowDefinition,
  inputId: string,
  blockId: string,
  portId: string,
): WorkflowDefinition {
  const withoutTarget = workflow.inputBindings.filter(
    (binding) =>
      !(binding.to.blockId === blockId && binding.to.portId === portId),
  );
  return {
    ...workflow,
    inputBindings: [
      ...withoutTarget,
      {
        id: crypto.randomUUID(),
        inputId,
        to: { blockId, portId },
      },
    ],
  };
}

export function unbindWorkflowInput(
  workflow: WorkflowDefinition,
  blockId: string,
  portId: string,
): WorkflowDefinition {
  return {
    ...workflow,
    inputBindings: workflow.inputBindings.filter(
      (binding) =>
        !(binding.to.blockId === blockId && binding.to.portId === portId),
    ),
  };
}

export function parseRunInputValue(
  kind: ArtifactKind,
  serialized: string,
): WorkflowRunInputValue {
  if (kind === 'text') return { kind: 'text', value: serialized };
  if (kind === 'json') {
    return { kind: 'json', value: JSON.parse(serialized) as JsonValue };
  }
  const path = serialized.trim();
  if (path === '') throw new Error('Choose a file or directory path.');
  return { kind: 'filesystem-reference', path, entity: 'unknown' };
}

export function serializeRunInputValue(
  value: WorkflowRunInputValue | undefined,
): string {
  if (value === undefined) return '';
  if (value.kind === 'text') return value.value;
  if (value.kind === 'json') return JSON.stringify(value.value, null, 2);
  return value.path;
}

export function buildWorkflowRunInputs(
  workflow: WorkflowDefinition,
  serializedValues: Readonly<Record<string, string>>,
): {
  readonly valid: boolean;
  readonly inputs: WorkflowRunInputs;
  readonly errors: Readonly<Record<string, string>>;
} {
  const inputs: WorkflowRunInputs = {};
  const errors: Record<string, string> = {};
  for (const definition of workflow.inputs) {
    const serialized = serializedValues[definition.id];
    if (serialized === undefined || serialized === '') {
      if (definition.defaultValue === undefined && definition.required) {
        errors[definition.id] = 'A value is required.';
      }
      continue;
    }
    try {
      inputs[definition.id] = parseRunInputValue(
        definition.artifactKind,
        serialized,
      );
    } catch (error) {
      errors[definition.id] =
        error instanceof Error ? error.message : String(error);
    }
  }

  if (Object.keys(errors).length === 0) {
    const validation = validateWorkflowRunInputs(workflow, inputs);
    for (const issue of validation.issues) {
      const inputId = /runInputs\.([^.[\]]+)/.exec(issue.path)?.[1];
      if (inputId !== undefined) errors[inputId] = issue.message;
    }
  }

  return { valid: Object.keys(errors).length === 0, inputs, errors };
}

function uniqueWorkflowInputId(workflow: WorkflowDefinition): string {
  const used = new Set(workflow.inputs.map((input) => input.id));
  let index = 1;
  while (used.has(`input-${index}`)) index += 1;
  return `input-${index}`;
}
