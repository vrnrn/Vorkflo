import type { Artifact } from './artifact.js';
import { createExecutionPlan } from './planner.js';
import type {
  ProcessOutputSpec,
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from './runner.js';
import { resolveWorkflowRunInputArtifacts } from './run-inputs.js';
import type {
  ProcessBlock,
  WorkflowDefinition,
  WorkflowRunInputs,
} from './schema.js';
import {
  analyzeInvocationTemplate,
  renderInvocationTemplate,
} from './invocation-template.js';
import type {
  BlockSkipReason,
  BlockTerminalState,
  ExecutionFailure,
  RuntimeEvent,
} from './runtime.js';

export interface BlockExecutionResult {
  readonly blockId: string;
  readonly state: BlockTerminalState;
  readonly inputs: Readonly<Record<string, Artifact>>;
  readonly outputs: Readonly<Record<string, Artifact>>;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly startedAt?: string;
  readonly completedAt: string;
  readonly failure?: ExecutionFailure;
  readonly skipReason?: BlockSkipReason;
}

export interface WorkflowExecutionResult {
  readonly runId: string;
  readonly workflowId: string;
  readonly outcome: 'succeeded' | 'failed' | 'cancelled';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly blocks: Readonly<Record<string, BlockExecutionResult>>;
  readonly events: readonly RuntimeEvent[];
}

export interface WorkflowExecutionOptions {
  readonly runId?: string;
  readonly signal?: AbortSignal;
  readonly hostEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly runInputs?: WorkflowRunInputs;
  readonly onEvent?: (event: RuntimeEvent) => void;
  /** Intended for deterministic hosts and tests. Values should be ISO-8601 strings. */
  readonly now?: () => string;
}

type RuntimeEventPayload = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, 'runId' | 'sequence' | 'occurredAt'>
    : never
  : never;

interface ExecutionContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly runner: ProcessRunner;
  readonly hostEnvironment: Readonly<Record<string, string | undefined>>;
  readonly now: () => string;
  readonly emit: (payload: RuntimeEventPayload, occurredAt?: string) => void;
  readonly results: Map<string, BlockExecutionResult>;
  readonly workflowInputArtifacts: ReadonlyMap<string, Artifact>;
}

class ResolutionError extends Error {
  readonly failure: ExecutionFailure;

  constructor(failure: ExecutionFailure) {
    super(failure.message);
    this.name = 'ResolutionError';
    this.failure = failure;
  }
}

let fallbackRunSequence = 0;

/**
 * Validates and executes a workflow using an injected process authority.
 *
 * The coordinator owns scheduling and validated artifact routing, while the
 * runner owns process launch, collection, output interpretation and termination.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  runner: ProcessRunner,
  options: WorkflowExecutionOptions = {},
): Promise<WorkflowExecutionResult> {
  const plan = createExecutionPlan(workflow);
  const now = options.now ?? (() => new Date().toISOString());
  const runId = options.runId ?? createRunId();
  const events: RuntimeEvent[] = [];
  const results = new Map<string, BlockExecutionResult>();
  let sequence = 0;
  let cancelRequested = false;

  const emit = (payload: RuntimeEventPayload, occurredAt = now()): void => {
    const event = immutableSnapshot({
      ...payload,
      runId,
      sequence,
      occurredAt,
    }) as RuntimeEvent;
    sequence += 1;
    events.push(event);
    try {
      options.onEvent?.(event);
    } catch {
      // Observers cannot alter execution semantics.
    }
  };

  const startedAt = now();
  const workflowInputArtifacts = resolveWorkflowRunInputArtifacts(
    workflow,
    options.runInputs,
    runId,
    startedAt,
  );
  emit({ type: 'execution_started', workflowId: workflow.id }, startedAt);
  for (const block of workflow.blocks) {
    emit({ type: 'block_queued', blockId: block.id });
  }

  const fallbackController = new AbortController();
  const signal = options.signal ?? fallbackController.signal;
  const recordCancellation = (): void => {
    if (cancelRequested) {
      return;
    }
    cancelRequested = true;
    emit({ type: 'execution_cancel_requested' });
  };
  signal.addEventListener('abort', recordCancellation, { once: true });
  if (signal.aborted) {
    recordCancellation();
  }

  const context: ExecutionContext = {
    runId,
    signal,
    runner,
    hostEnvironment: options.hostEnvironment ?? {},
    now,
    emit,
    results,
    workflowInputArtifacts,
  };

  const blocks = new Map(workflow.blocks.map((block) => [block.id, block]));
  const incomingBlockIds = collectIncomingBlockIds(workflow);
  const blockPromises = new Map<string, Promise<BlockExecutionResult>>();

  try {
    for (const layer of plan.layers) {
      for (const blockId of layer) {
        const block = blocks.get(blockId);
        if (block === undefined) {
          continue;
        }
        const dependencyPromises = (incomingBlockIds.get(blockId) ?? []).map(
          (dependencyId) => {
            const promise = blockPromises.get(dependencyId);
            if (promise === undefined) {
              throw new Error(
                `Execution plan did not schedule dependency "${dependencyId}" before "${blockId}".`,
              );
            }
            return promise;
          },
        );
        const blockPromise = Promise.all(dependencyPromises).then(
          (dependencyResults) =>
            executeBlock(workflow, block, dependencyResults, context),
        );
        blockPromises.set(blockId, blockPromise);
      }
    }

    await Promise.all(blockPromises.values());
  } finally {
    signal.removeEventListener('abort', recordCancellation);
  }

  const orderedResults = keyedRecord<BlockExecutionResult>();
  for (const block of workflow.blocks) {
    const result = results.get(block.id);
    if (result !== undefined) {
      orderedResults[block.id] = result;
    }
  }

  const terminalResults = Object.values(orderedResults);
  const outcome = determineOutcome(terminalResults, cancelRequested);
  const completedAt = now();
  emit({ type: 'execution_completed', outcome }, completedAt);

  return {
    runId,
    workflowId: workflow.id,
    outcome,
    startedAt,
    completedAt,
    blocks: orderedResults,
    events,
  };
}

async function executeBlock(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  dependencyResults: readonly BlockExecutionResult[],
  context: ExecutionContext,
): Promise<BlockExecutionResult> {
  const blockedDependencies = dependencyResults.filter(
    (result) => result.state !== 'succeeded',
  );
  if (blockedDependencies.length > 0) {
    const skipReason = createSkipReason(blockedDependencies);
    const completedAt = context.now();
    context.emit(
      {
        type: 'block_state_changed',
        blockId: block.id,
        from: 'queued',
        to: 'skipped',
        skipReason,
      },
      completedAt,
    );
    context.emit(
      {
        type: 'block_completed',
        blockId: block.id,
        state: 'skipped',
        exitCode: null,
        skipReason,
      },
      completedAt,
    );
    return recordResult(context, {
      blockId: block.id,
      state: 'skipped',
      inputs: keyedRecord(),
      outputs: keyedRecord(),
      stdout: '',
      stderr: '',
      exitCode: null,
      completedAt,
      skipReason,
    });
  }

  if (context.signal.aborted) {
    const completedAt = context.now();
    context.emit(
      {
        type: 'block_state_changed',
        blockId: block.id,
        from: 'queued',
        to: 'cancelled',
      },
      completedAt,
    );
    context.emit(
      {
        type: 'block_completed',
        blockId: block.id,
        state: 'cancelled',
        exitCode: null,
      },
      completedAt,
    );
    return recordResult(context, {
      blockId: block.id,
      state: 'cancelled',
      inputs: keyedRecord(),
      outputs: keyedRecord(),
      stdout: '',
      stderr: '',
      exitCode: null,
      completedAt,
    });
  }

  const startedAt = context.now();
  context.emit(
    {
      type: 'block_state_changed',
      blockId: block.id,
      from: 'queued',
      to: 'running',
    },
    startedAt,
  );

  let inputs: Readonly<Record<string, Artifact>> = keyedRecord();
  let request: ProcessRunRequest;
  try {
    inputs = resolveInputs(
      workflow,
      block,
      context.results,
      context.workflowInputArtifacts,
    );
    context.emit({
      type: 'block_inputs_resolved',
      blockId: block.id,
      inputs,
    });
    request = resolveRunRequest(block, inputs, context);
  } catch (error) {
    const failure = toResolutionFailure(error);
    return completeFailedBlock(
      block.id,
      inputs,
      '',
      '',
      null,
      startedAt,
      failure,
      context,
    );
  }

  let processResult: ProcessRunResult;
  try {
    processResult = await context.runner.run(request, {
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal.aborted || isAbortError(error)) {
      return completeCancelledBlock(
        block.id,
        inputs,
        '',
        '',
        null,
        startedAt,
        context,
      );
    }
    return completeFailedBlock(
      block.id,
      inputs,
      '',
      '',
      null,
      startedAt,
      {
        code: 'process_launch_failed',
        message: describeThrownError(error),
        nextAction:
          'Inspect the executable, working directory, and runner diagnostics.',
      },
      context,
    );
  }

  emitProcessOutput(block.id, processResult, context);

  if (
    context.signal.aborted &&
    !(
      processResult.status === 'failed' &&
      processResult.failure.code === 'process_termination_failed'
    )
  ) {
    return completeCancelledBlock(
      block.id,
      inputs,
      processResult.stdout,
      processResult.stderr,
      processResult.exitCode,
      startedAt,
      context,
    );
  }

  if (processResult.status === 'failed') {
    return completeFailedBlock(
      block.id,
      inputs,
      processResult.stdout,
      processResult.stderr,
      processResult.exitCode,
      startedAt,
      processResult.failure,
      context,
    );
  }

  if (processResult.status === 'cancelled') {
    return completeCancelledBlock(
      block.id,
      inputs,
      processResult.stdout,
      processResult.stderr,
      processResult.exitCode,
      startedAt,
      context,
    );
  }

  let outputs: Readonly<Record<string, Artifact>>;
  try {
    outputs = routeProducedArtifacts(block, processResult, context);
  } catch (error) {
    return completeFailedBlock(
      block.id,
      inputs,
      processResult.stdout,
      processResult.stderr,
      processResult.exitCode,
      startedAt,
      toResolutionFailure(error),
      context,
    );
  }

  context.emit({
    type: 'block_outputs_produced',
    blockId: block.id,
    outputs,
  });
  const completedAt = context.now();
  context.emit(
    {
      type: 'block_state_changed',
      blockId: block.id,
      from: 'running',
      to: 'succeeded',
    },
    completedAt,
  );
  context.emit(
    {
      type: 'block_completed',
      blockId: block.id,
      state: 'succeeded',
      exitCode: processResult.exitCode,
    },
    completedAt,
  );
  return recordResult(context, {
    blockId: block.id,
    state: 'succeeded',
    inputs,
    outputs,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode,
    startedAt,
    completedAt,
  });
}

function resolveInputs(
  workflow: WorkflowDefinition,
  block: ProcessBlock,
  results: ReadonlyMap<string, BlockExecutionResult>,
  workflowInputArtifacts: ReadonlyMap<string, Artifact>,
): Readonly<Record<string, Artifact>> {
  const inputs = keyedRecord<Artifact>();
  for (const binding of workflow.inputBindings) {
    if (binding.to.blockId !== block.id) continue;
    const artifact = workflowInputArtifacts.get(binding.inputId);
    if (artifact !== undefined) inputs[binding.to.portId] = artifact;
  }
  for (const connection of workflow.connections) {
    if (connection.to.blockId !== block.id) {
      continue;
    }
    const artifact = results.get(connection.from.blockId)?.outputs[
      connection.from.portId
    ];
    if (artifact === undefined) {
      throw new ResolutionError({
        code: 'artifact_routing_failed',
        message: `Block "${block.id}" could not resolve input "${connection.to.portId}" from "${connection.from.blockId}.${connection.from.portId}".`,
        nextAction: 'Inspect the upstream output and workflow connection.',
      });
    }
    inputs[connection.to.portId] = artifact;
  }
  return inputs;
}

function resolveRunRequest(
  block: ProcessBlock,
  inputs: Readonly<Record<string, Artifact>>,
  context: ExecutionContext,
): ProcessRunRequest {
  const resolvedArguments: string[] = [];
  for (const argument of block.invocation.arguments) {
    if (argument.type === 'literal') {
      resolvedArguments.push(argument.value);
      continue;
    }
    if (argument.type === 'input') {
      const artifact = inputs[argument.portId];
      if (artifact !== undefined) {
        resolvedArguments.push(artifactToString(artifact));
      }
      continue;
    }
    resolvedArguments.push(resolveInvocationTemplate(argument, block, inputs));
  }

  const environment = keyedRecord<string>();
  for (const [name, binding] of Object.entries(block.invocation.environment)) {
    if (binding.source === 'literal') {
      environment[name] = binding.value;
      continue;
    }
    if (binding.source === 'host') {
      const value = context.hostEnvironment[binding.name];
      if (
        !Object.hasOwn(context.hostEnvironment, binding.name) ||
        value === undefined
      ) {
        throw new ResolutionError({
          code: 'host_environment_variable_missing',
          message: `Host environment variable "${binding.name}" required by block "${block.id}" is not available.`,
          nextAction: `Define "${binding.name}" in the local runtime environment before running this workflow.`,
        });
      }
      environment[name] = value;
      continue;
    }
    const artifact = inputs[binding.portId];
    if (artifact !== undefined) {
      environment[name] = artifactToString(artifact);
    }
  }

  const workingDirectory = block.invocation.workingDirectory;
  const stdinBinding = block.invocation.stdin;
  const stdinArtifact =
    stdinBinding !== undefined && 'portId' in stdinBinding
      ? inputs[stdinBinding.portId]
      : undefined;
  const stdin =
    stdinBinding === undefined
      ? undefined
      : 'portId' in stdinBinding
        ? stdinArtifact === undefined
          ? undefined
          : artifactToString(stdinArtifact)
        : resolveInvocationTemplate(stdinBinding, block, inputs);

  return {
    runId: context.runId,
    blockId: block.id,
    executable: block.invocation.executable,
    arguments: resolvedArguments,
    shell: block.invocation.shell,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(block.invocation.timeoutMs === undefined
      ? {}
      : { timeoutMs: block.invocation.timeoutMs }),
    environment,
    ...(stdin === undefined ? {} : { stdin }),
    outputs: resolveOutputSpecs(block),
  };
}

function resolveInvocationTemplate(
  binding: {
    readonly template: string;
    readonly inputs: Readonly<
      Record<string, { readonly portId: string } | { readonly value: string }>
    >;
  },
  block: ProcessBlock,
  inputs: Readonly<Record<string, Artifact>>,
): string {
  const analysis = analyzeInvocationTemplate(binding.template);
  const names = new Set(analysis.placeholders);
  if (
    analysis.malformed ||
    names.size !== analysis.placeholders.length ||
    analysis.placeholders.some(
      (name) => !Object.hasOwn(binding.inputs, name),
    ) ||
    Object.keys(binding.inputs).some((name) => !names.has(name))
  ) {
    throw new ResolutionError({
      code: 'artifact_routing_failed',
      message: `Block "${block.id}" has an invalid invocation template.`,
      nextAction: 'Inspect the template placeholders and their input bindings.',
    });
  }

  const values = keyedRecord<string>();
  for (const [name, inputBinding] of Object.entries(binding.inputs)) {
    if ('value' in inputBinding) {
      values[name] = inputBinding.value;
      continue;
    }
    const artifact = inputs[inputBinding.portId];
    if (artifact === undefined) {
      const port = block.inputs.find(
        (candidate) => candidate.id === inputBinding.portId,
      );
      if (port?.required === true) {
        throw new ResolutionError({
          code: 'artifact_routing_failed',
          message: `Block "${block.id}" could not resolve required template input "${inputBinding.portId}".`,
          nextAction: 'Inspect the workflow bindings and upstream artifacts.',
        });
      }
      values[name] = '';
    } else {
      values[name] = artifactToString(artifact);
    }
  }
  return renderInvocationTemplate(binding.template, values);
}

function resolveOutputSpecs(block: ProcessBlock): readonly ProcessOutputSpec[] {
  return block.invocation.outputs.map((binding) => {
    const port = block.outputs.find((output) => output.id === binding.portId);
    if (port === undefined) {
      throw new ResolutionError({
        code: 'artifact_routing_failed',
        message: `Block "${block.id}" has an output binding for missing port "${binding.portId}".`,
      });
    }
    if (binding.type === 'filesystem') {
      return {
        portId: binding.portId,
        kind: 'filesystem-reference',
        path: binding.path,
        ...(binding.entity === undefined ? {} : { entity: binding.entity }),
      };
    }
    return {
      portId: binding.portId,
      kind: port.artifactKind as 'text' | 'json',
      source: binding.type,
    };
  });
}

function routeProducedArtifacts(
  block: ProcessBlock,
  result: Extract<ProcessRunResult, { readonly status: 'succeeded' }>,
  context: ExecutionContext,
): Readonly<Record<string, Artifact>> {
  const outputs = keyedRecord<Artifact>();
  const expected = new Map(
    resolveOutputSpecs(block).map((spec) => [spec.portId, spec.kind]),
  );
  for (const artifact of result.artifacts) {
    const portId =
      'portId' in artifact.provenance
        ? artifact.provenance.portId
        : '(workflow-input)';
    const expectedKind = expected.get(portId);
    if (
      !('blockId' in artifact.provenance) ||
      artifact.provenance.runId !== context.runId ||
      artifact.provenance.blockId !== block.id ||
      expectedKind === undefined ||
      artifact.kind !== expectedKind ||
      Object.hasOwn(outputs, portId)
    ) {
      throw new ResolutionError({
        code: 'artifact_routing_failed',
        message: `Runner returned an undeclared, mismatched, or duplicate artifact for block "${block.id}" port "${portId}".`,
        nextAction:
          'Inspect the process runner output declarations and artifact provenance.',
      });
    }
    outputs[portId] = artifact;
  }
  for (const portId of expected.keys()) {
    if (!Object.hasOwn(outputs, portId)) {
      throw new ResolutionError({
        code: 'artifact_routing_failed',
        message: `Runner did not return the declared artifact for block "${block.id}" port "${portId}".`,
        nextAction:
          'Inspect the process output and runner artifact diagnostics.',
      });
    }
  }
  return outputs;
}

function completeFailedBlock(
  blockId: string,
  inputs: Readonly<Record<string, Artifact>>,
  stdout: string,
  stderr: string,
  exitCode: number | null,
  startedAt: string,
  failure: ExecutionFailure,
  context: ExecutionContext,
): BlockExecutionResult {
  const completedAt = context.now();
  context.emit(
    {
      type: 'block_state_changed',
      blockId,
      from: 'running',
      to: 'failed',
      failure,
    },
    completedAt,
  );
  context.emit(
    {
      type: 'block_completed',
      blockId,
      state: 'failed',
      exitCode,
      failure,
    },
    completedAt,
  );
  return recordResult(context, {
    blockId,
    state: 'failed',
    inputs,
    outputs: keyedRecord(),
    stdout,
    stderr,
    exitCode,
    startedAt,
    completedAt,
    failure,
  });
}

function completeCancelledBlock(
  blockId: string,
  inputs: Readonly<Record<string, Artifact>>,
  stdout: string,
  stderr: string,
  exitCode: number | null,
  startedAt: string,
  context: ExecutionContext,
): BlockExecutionResult {
  const completedAt = context.now();
  context.emit(
    {
      type: 'block_state_changed',
      blockId,
      from: 'running',
      to: 'cancelled',
    },
    completedAt,
  );
  context.emit(
    {
      type: 'block_completed',
      blockId,
      state: 'cancelled',
      exitCode,
    },
    completedAt,
  );
  return recordResult(context, {
    blockId,
    state: 'cancelled',
    inputs,
    outputs: keyedRecord(),
    stdout,
    stderr,
    exitCode,
    startedAt,
    completedAt,
  });
}

function recordResult(
  context: ExecutionContext,
  result: BlockExecutionResult,
): BlockExecutionResult {
  context.results.set(result.blockId, result);
  return result;
}

function emitProcessOutput(
  blockId: string,
  result: ProcessRunResult,
  context: ExecutionContext,
): void {
  if (result.stdout.length > 0) {
    context.emit({ type: 'block_stdout', blockId, text: result.stdout });
  }
  if (result.stderr.length > 0) {
    context.emit({ type: 'block_stderr', blockId, text: result.stderr });
  }
}

function createSkipReason(
  results: readonly BlockExecutionResult[],
): BlockSkipReason {
  const upstreamBlockIds = results.map((result) => result.blockId);
  const cancelled = results.some(
    (result) =>
      result.state === 'cancelled' ||
      result.skipReason?.code === 'upstream_cancelled',
  );
  return {
    code: cancelled ? 'upstream_cancelled' : 'upstream_failed',
    message: `Required upstream block${results.length === 1 ? '' : 's'} ${upstreamBlockIds.join(', ')} did not succeed.`,
    upstreamBlockIds,
  };
}

function collectIncomingBlockIds(
  workflow: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const incoming = new Map<string, string[]>();
  for (const block of workflow.blocks) {
    incoming.set(block.id, []);
  }
  for (const connection of workflow.connections) {
    const blockIds = incoming.get(connection.to.blockId);
    if (blockIds !== undefined && !blockIds.includes(connection.from.blockId)) {
      blockIds.push(connection.from.blockId);
    }
  }
  return incoming;
}

function determineOutcome(
  results: readonly BlockExecutionResult[],
  cancelRequested: boolean,
): WorkflowExecutionResult['outcome'] {
  if (
    cancelRequested ||
    results.some((result) => result.state === 'cancelled')
  ) {
    return 'cancelled';
  }
  if (results.some((result) => result.state === 'failed')) {
    return 'failed';
  }
  return 'succeeded';
}

function artifactToString(artifact: Artifact): string {
  switch (artifact.kind) {
    case 'text':
      return artifact.value;
    case 'json':
      return JSON.stringify(artifact.value);
    case 'filesystem-reference':
      return artifact.path;
  }
}

function toResolutionFailure(error: unknown): ExecutionFailure {
  if (error instanceof ResolutionError) {
    return error.failure;
  }
  return {
    code: 'artifact_routing_failed',
    message: describeThrownError(error),
    nextAction: 'Inspect the workflow bindings and upstream artifacts.',
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function describeThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackRunSequence += 1;
  return `run-${Date.now()}-${fallbackRunSequence}`;
}

function keyedRecord<Value>(): Record<string, Value> {
  return Object.create(null) as Record<string, Value>;
}

function immutableSnapshot<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return value;
  }
  const object = value as object;
  if (seen.has(object)) {
    return value;
  }
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    deepFreeze((object as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}
