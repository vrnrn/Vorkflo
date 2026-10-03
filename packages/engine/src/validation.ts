import type {
  ArtifactKind,
  ProcessBlock,
  WorkflowDefinition,
} from './schema.js';
import { analyzeInvocationTemplate } from './invocation-template.js';

export type ValidationIssueCode =
  | 'duplicate_block_id'
  | 'duplicate_connection_id'
  | 'duplicate_workflow_input_id'
  | 'duplicate_workflow_input_binding_id'
  | 'duplicate_port_id'
  | 'missing_workflow_input'
  | 'missing_workflow_input_target_block'
  | 'missing_workflow_input_target_port'
  | 'workflow_input_kind_mismatch'
  | 'workflow_input_default_kind_mismatch'
  | 'multiple_bindings_to_input'
  | 'missing_source_block'
  | 'missing_target_block'
  | 'missing_source_port'
  | 'missing_target_port'
  | 'incompatible_artifact_kinds'
  | 'multiple_connections_to_input'
  | 'required_input_unconnected'
  | 'input_port_unbound'
  | 'output_port_unbound'
  | 'binding_references_missing_port'
  | 'duplicate_output_binding'
  | 'output_binding_kind_mismatch'
  | 'multiple_stdout_outputs'
  | 'multiple_stderr_outputs'
  | 'invocation_template_malformed_placeholder'
  | 'invocation_template_duplicate_placeholder'
  | 'invocation_template_missing_input'
  | 'invocation_template_unknown_input'
  | 'cycle_detected';

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

interface PortReference {
  readonly artifactKind: ArtifactKind;
}

export function validateWorkflow(
  workflow: WorkflowDefinition,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const blocks = new Map<string, ProcessBlock>();

  for (const [blockIndex, block] of workflow.blocks.entries()) {
    if (blocks.has(block.id)) {
      issues.push({
        code: 'duplicate_block_id',
        message: `Block ID "${block.id}" is used more than once.`,
        path: `blocks[${blockIndex}].id`,
      });
    } else {
      blocks.set(block.id, block);
    }

    validateBlockBindings(block, blockIndex, issues);
  }

  const workflowInputs = new Map(
    workflow.inputs.map((input) => [input.id, input] as const),
  );
  const workflowInputIds = new Set<string>();
  for (const [inputIndex, input] of workflow.inputs.entries()) {
    if (workflowInputIds.has(input.id)) {
      issues.push({
        code: 'duplicate_workflow_input_id',
        message: `Workflow input ID "${input.id}" is used more than once.`,
        path: `inputs[${inputIndex}].id`,
      });
    }
    workflowInputIds.add(input.id);

    if (
      input.defaultValue !== undefined &&
      input.defaultValue.kind !== input.artifactKind
    ) {
      issues.push({
        code: 'workflow_input_default_kind_mismatch',
        message: `Default value for workflow input "${input.id}" has kind "${input.defaultValue.kind}", but the input declares "${input.artifactKind}".`,
        path: `inputs[${inputIndex}].defaultValue`,
      });
    }
  }

  const workflowInputBindingIds = new Set<string>();
  const workflowInputTargetCounts = new Map<string, Map<string, number>>();
  for (const [bindingIndex, binding] of workflow.inputBindings.entries()) {
    if (workflowInputBindingIds.has(binding.id)) {
      issues.push({
        code: 'duplicate_workflow_input_binding_id',
        message: `Workflow input binding ID "${binding.id}" is used more than once.`,
        path: `inputBindings[${bindingIndex}].id`,
      });
    }
    workflowInputBindingIds.add(binding.id);

    const input = workflowInputs.get(binding.inputId);
    const targetBlock = blocks.get(binding.to.blockId);
    const targetPort = findInputPort(targetBlock, binding.to.portId);

    if (input === undefined) {
      issues.push({
        code: 'missing_workflow_input',
        message: `Workflow input "${binding.inputId}" does not exist.`,
        path: `inputBindings[${bindingIndex}].inputId`,
      });
    }
    if (targetBlock === undefined) {
      issues.push({
        code: 'missing_workflow_input_target_block',
        message: `Workflow input binding target block "${binding.to.blockId}" does not exist.`,
        path: `inputBindings[${bindingIndex}].to.blockId`,
      });
    } else if (targetPort === undefined) {
      issues.push({
        code: 'missing_workflow_input_target_port',
        message: `Input port "${binding.to.portId}" does not exist on block "${targetBlock.id}".`,
        path: `inputBindings[${bindingIndex}].to.portId`,
      });
    }

    if (input !== undefined && targetPort !== undefined) {
      if (input.artifactKind !== targetPort.artifactKind) {
        issues.push({
          code: 'workflow_input_kind_mismatch',
          message: `Cannot bind ${input.artifactKind} workflow input to ${targetPort.artifactKind} block input.`,
          path: `inputBindings[${bindingIndex}]`,
        });
      }
      let blockCounts = workflowInputTargetCounts.get(binding.to.blockId);
      if (blockCounts === undefined) {
        blockCounts = new Map();
        workflowInputTargetCounts.set(binding.to.blockId, blockCounts);
      }
      blockCounts.set(
        binding.to.portId,
        (blockCounts.get(binding.to.portId) ?? 0) + 1,
      );
    }
  }

  const connectionIds = new Set<string>();
  const targetConnectionCounts = new Map<string, Map<string, number>>();

  for (const [connectionIndex, connection] of workflow.connections.entries()) {
    if (connectionIds.has(connection.id)) {
      issues.push({
        code: 'duplicate_connection_id',
        message: `Connection ID "${connection.id}" is used more than once.`,
        path: `connections[${connectionIndex}].id`,
      });
    }
    connectionIds.add(connection.id);

    const sourceBlock = blocks.get(connection.from.blockId);
    const targetBlock = blocks.get(connection.to.blockId);

    if (sourceBlock === undefined) {
      issues.push({
        code: 'missing_source_block',
        message: `Source block "${connection.from.blockId}" does not exist.`,
        path: `connections[${connectionIndex}].from.blockId`,
      });
    }

    if (targetBlock === undefined) {
      issues.push({
        code: 'missing_target_block',
        message: `Target block "${connection.to.blockId}" does not exist.`,
        path: `connections[${connectionIndex}].to.blockId`,
      });
    }

    const sourcePort = findOutputPort(sourceBlock, connection.from.portId);
    const targetPort = findInputPort(targetBlock, connection.to.portId);

    if (sourceBlock !== undefined && sourcePort === undefined) {
      issues.push({
        code: 'missing_source_port',
        message: `Output port "${connection.from.portId}" does not exist on block "${sourceBlock.id}".`,
        path: `connections[${connectionIndex}].from.portId`,
      });
    }

    if (targetBlock !== undefined && targetPort === undefined) {
      issues.push({
        code: 'missing_target_port',
        message: `Input port "${connection.to.portId}" does not exist on block "${targetBlock.id}".`,
        path: `connections[${connectionIndex}].to.portId`,
      });
    }

    if (
      sourcePort !== undefined &&
      targetPort !== undefined &&
      sourcePort.artifactKind !== targetPort.artifactKind
    ) {
      issues.push({
        code: 'incompatible_artifact_kinds',
        message: `Cannot connect ${sourcePort.artifactKind} output to ${targetPort.artifactKind} input.`,
        path: `connections[${connectionIndex}]`,
      });
    }

    if (targetPort !== undefined && targetBlock !== undefined) {
      let blockCounts = targetConnectionCounts.get(targetBlock.id);
      if (blockCounts === undefined) {
        blockCounts = new Map();
        targetConnectionCounts.set(targetBlock.id, blockCounts);
      }
      const nextCount = (blockCounts.get(connection.to.portId) ?? 0) + 1;
      blockCounts.set(connection.to.portId, nextCount);
      if (nextCount > 1) {
        issues.push({
          code: 'multiple_connections_to_input',
          message: `Input "${connection.to.portId}" on block "${targetBlock.id}" has more than one connection.`,
          path: `connections[${connectionIndex}].to`,
        });
      }
    }
  }

  for (const [blockIndex, block] of workflow.blocks.entries()) {
    for (const [portIndex, input] of block.inputs.entries()) {
      const sourceCount =
        (targetConnectionCounts.get(block.id)?.get(input.id) ?? 0) +
        (workflowInputTargetCounts.get(block.id)?.get(input.id) ?? 0);
      if (sourceCount > 1) {
        issues.push({
          code: 'multiple_bindings_to_input',
          message: `Input "${input.id}" on block "${block.id}" has more than one graph or workflow-input source.`,
          path: `blocks[${blockIndex}].inputs[${portIndex}]`,
        });
      }
      if (input.required && sourceCount === 0) {
        issues.push({
          code: 'required_input_unconnected',
          message: `Required input "${input.id}" on block "${block.id}" has no graph connection or workflow-input binding.`,
          path: `blocks[${blockIndex}].inputs[${portIndex}]`,
        });
      }
    }
  }

  if (containsCycle(workflow, blocks)) {
    issues.push({
      code: 'cycle_detected',
      message: 'Workflow connections must form a directed acyclic graph.',
      path: 'connections',
    });
  }

  return { valid: issues.length === 0, issues };
}

function validateBlockBindings(
  block: ProcessBlock,
  blockIndex: number,
  issues: ValidationIssue[],
): void {
  const inputIds = collectPortIds(
    block.inputs.map((port) => port.id),
    block,
    blockIndex,
    'inputs',
    issues,
  );
  const outputIds = collectPortIds(
    block.outputs.map((port) => port.id),
    block,
    blockIndex,
    'outputs',
    issues,
  );

  const referencedInputs = new Set<string>();
  for (const [
    argumentIndex,
    argument,
  ] of block.invocation.arguments.entries()) {
    if (argument.type === 'input') {
      validateInputReference(
        argument.portId,
        `blocks[${blockIndex}].invocation.arguments[${argumentIndex}]`,
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    } else if (argument.type === 'template') {
      validateInvocationTemplate(
        argument,
        `blocks[${blockIndex}].invocation.arguments[${argumentIndex}]`,
        'Argument',
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    }
  }

  if (block.invocation.stdin !== undefined) {
    if ('portId' in block.invocation.stdin) {
      validateInputReference(
        block.invocation.stdin.portId,
        `blocks[${blockIndex}].invocation.stdin`,
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    } else {
      validateInvocationTemplate(
        block.invocation.stdin,
        `blocks[${blockIndex}].invocation.stdin`,
        'Stdin',
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    }
  }

  for (const [name, value] of Object.entries(block.invocation.environment)) {
    if (value.source === 'input') {
      validateInputReference(
        value.portId,
        `blocks[${blockIndex}].invocation.environment.${name}`,
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    }
  }

  for (const [portIndex, input] of block.inputs.entries()) {
    if (!referencedInputs.has(input.id)) {
      issues.push({
        code: 'input_port_unbound',
        message: `Input port "${input.id}" on block "${block.id}" is not bound to the process invocation.`,
        path: `blocks[${blockIndex}].inputs[${portIndex}]`,
      });
    }
  }

  const boundOutputs = new Set<string>();
  let stdoutBindings = 0;
  let stderrBindings = 0;
  for (const [bindingIndex, binding] of block.invocation.outputs.entries()) {
    const output = block.outputs.find((port) => port.id === binding.portId);
    if (!outputIds.has(binding.portId) || output === undefined) {
      issues.push({
        code: 'binding_references_missing_port',
        message: `Output binding references missing port "${binding.portId}" on block "${block.id}".`,
        path: `blocks[${blockIndex}].invocation.outputs[${bindingIndex}]`,
      });
      continue;
    }

    if (boundOutputs.has(binding.portId)) {
      issues.push({
        code: 'duplicate_output_binding',
        message: `Output port "${binding.portId}" on block "${block.id}" has more than one output binding.`,
        path: `blocks[${blockIndex}].invocation.outputs[${bindingIndex}]`,
      });
      continue;
    }
    boundOutputs.add(binding.portId);
    if (binding.type === 'stdout') {
      stdoutBindings += 1;
    }
    if (binding.type === 'stderr') {
      stderrBindings += 1;
    }

    const bindingMatchesKind =
      (binding.type === 'filesystem' &&
        output.artifactKind === 'filesystem-reference') ||
      ((binding.type === 'stdout' || binding.type === 'stderr') &&
        (output.artifactKind === 'text' || output.artifactKind === 'json'));

    if (!bindingMatchesKind) {
      issues.push({
        code: 'output_binding_kind_mismatch',
        message: `Output binding type "${binding.type}" cannot produce artifact kind "${output.artifactKind}".`,
        path: `blocks[${blockIndex}].invocation.outputs[${bindingIndex}]`,
      });
    }
  }

  if (stdoutBindings > 1) {
    issues.push({
      code: 'multiple_stdout_outputs',
      message: `Block "${block.id}" binds stdout to more than one output.`,
      path: `blocks[${blockIndex}].invocation.outputs`,
    });
  }

  if (stderrBindings > 1) {
    issues.push({
      code: 'multiple_stderr_outputs',
      message: `Block "${block.id}" binds stderr to more than one output.`,
      path: `blocks[${blockIndex}].invocation.outputs`,
    });
  }

  for (const [portIndex, output] of block.outputs.entries()) {
    if (!boundOutputs.has(output.id)) {
      issues.push({
        code: 'output_port_unbound',
        message: `Output port "${output.id}" on block "${block.id}" has no output binding.`,
        path: `blocks[${blockIndex}].outputs[${portIndex}]`,
      });
    }
  }
}

function validateInvocationTemplate(
  binding: {
    readonly template: string;
    readonly inputs: Readonly<
      Record<string, { readonly portId: string } | { readonly value: string }>
    >;
  },
  path: string,
  label: 'Argument' | 'Stdin',
  block: ProcessBlock,
  inputIds: ReadonlySet<string>,
  referencedInputs: Set<string>,
  issues: ValidationIssue[],
): void {
  const analysis = analyzeInvocationTemplate(binding.template);
  if (analysis.malformed) {
    issues.push({
      code: 'invocation_template_malformed_placeholder',
      message: `${label} template on block "${block.id}" contains a malformed placeholder. Use {{name}} with a portable name.`,
      path: `${path}.template`,
    });
  }

  const occurrences = new Map<string, number>();
  for (const name of analysis.placeholders) {
    occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  }
  for (const [name, count] of occurrences) {
    if (count > 1) {
      issues.push({
        code: 'invocation_template_duplicate_placeholder',
        message: `${label} template placeholder "${name}" appears more than once on block "${block.id}".`,
        path: `${path}.template`,
      });
    }
    if (!Object.hasOwn(binding.inputs, name)) {
      issues.push({
        code: 'invocation_template_missing_input',
        message: `${label} template placeholder "${name}" has no input binding on block "${block.id}".`,
        path: `${path}.inputs`,
      });
    }
  }

  for (const [name, inputBinding] of Object.entries(binding.inputs)) {
    if (!occurrences.has(name)) {
      issues.push({
        code: 'invocation_template_unknown_input',
        message: `${label} template input "${name}" has no matching placeholder on block "${block.id}".`,
        path: `${path}.inputs.${name}`,
      });
    }
    if ('portId' in inputBinding) {
      validateInputReference(
        inputBinding.portId,
        `${path}.inputs.${name}`,
        block,
        inputIds,
        referencedInputs,
        issues,
      );
    }
  }
}

function collectPortIds(
  portIds: readonly string[],
  block: ProcessBlock,
  blockIndex: number,
  direction: 'inputs' | 'outputs',
  issues: ValidationIssue[],
): Set<string> {
  const uniqueIds = new Set<string>();
  for (const [portIndex, portId] of portIds.entries()) {
    if (uniqueIds.has(portId)) {
      issues.push({
        code: 'duplicate_port_id',
        message: `Port ID "${portId}" is duplicated in ${direction} on block "${block.id}".`,
        path: `blocks[${blockIndex}].${direction}[${portIndex}].id`,
      });
    }
    uniqueIds.add(portId);
  }
  return uniqueIds;
}

function validateInputReference(
  portId: string,
  path: string,
  block: ProcessBlock,
  inputIds: ReadonlySet<string>,
  referencedInputs: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!inputIds.has(portId)) {
    issues.push({
      code: 'binding_references_missing_port',
      message: `Invocation binding references missing input "${portId}" on block "${block.id}".`,
      path,
    });
    return;
  }
  referencedInputs.add(portId);
}

function findOutputPort(
  block: ProcessBlock | undefined,
  portId: string,
): PortReference | undefined {
  const port = block?.outputs.find((candidate) => candidate.id === portId);
  return port === undefined ? undefined : { artifactKind: port.artifactKind };
}

function findInputPort(
  block: ProcessBlock | undefined,
  portId: string,
): PortReference | undefined {
  const port = block?.inputs.find((candidate) => candidate.id === portId);
  return port === undefined ? undefined : { artifactKind: port.artifactKind };
}

function containsCycle(
  workflow: WorkflowDefinition,
  blocks: ReadonlyMap<string, ProcessBlock>,
): boolean {
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const blockId of blocks.keys()) {
    inDegree.set(blockId, 0);
    outgoing.set(blockId, []);
  }

  for (const connection of workflow.connections) {
    if (
      !blocks.has(connection.from.blockId) ||
      !blocks.has(connection.to.blockId)
    ) {
      continue;
    }
    outgoing.get(connection.from.blockId)?.push(connection.to.blockId);
    inDegree.set(
      connection.to.blockId,
      (inDegree.get(connection.to.blockId) ?? 0) + 1,
    );
  }

  const queue = [...blocks.keys()].filter((id) => inDegree.get(id) === 0);
  let visited = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const blockId = queue[index];
    if (blockId === undefined) {
      continue;
    }
    visited += 1;
    for (const targetId of outgoing.get(blockId) ?? []) {
      const nextDegree = (inDegree.get(targetId) ?? 0) - 1;
      inDegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        queue.push(targetId);
      }
    }
  }

  return visited !== blocks.size;
}
