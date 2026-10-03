import { dirname, isAbsolute, resolve } from 'node:path';
import {
  executeWorkflow,
  resolveWorkflowRunInputValues,
  type Artifact,
  type ProcessRunner,
  type ProcessRunResult,
  type RuntimeEvent,
  type WorkflowExecutionResult,
  type WorkflowDefinition,
  type WorkflowRunInputs,
} from '@vorkflo/engine';
import {
  canonicalizeNodeWorkflowRunInputs,
  NodeProcessRunner,
} from '@vorkflo/node-runner';
import type { BlockRunSnapshot, DesktopRunEvent } from '../shared/contracts.js';
import type { RunHistoryRecord } from '../shared/contracts.js';
import {
  getAgentBlockPresentation,
  type AgentRuntimeId,
} from '../shared/agent-runtime.js';

type EventSink = (event: DesktopRunEvent) => void;

export interface ActiveRun {
  readonly runId: string;
  cancel(): void;
  readonly completion: Promise<void>;
}

export interface StartWorkflowRunOptions {
  readonly runId?: string;
  readonly baseDirectory?: string;
  readonly runInputs?: WorkflowRunInputs;
  /** Process authority injection used by tests and alternate desktop hosts. */
  readonly runner?: ProcessRunner;
  readonly onCompleted?: (record: RunHistoryRecord) => void | Promise<void>;
}

export function resolveDesktopWorkflowBaseDirectory(
  workflowFilePath: string | undefined,
  homeDirectory: string,
): string {
  if (workflowFilePath === undefined) return resolve(homeDirectory);
  if (!isAbsolute(workflowFilePath)) {
    throw new Error('Workflow file paths must be absolute.');
  }
  return dirname(resolve(workflowFilePath));
}

export function applyDefaultWorkingDirectory(
  workflow: WorkflowDefinition,
  defaultWorkingDirectory: string,
): WorkflowDefinition {
  return {
    ...workflow,
    blocks: workflow.blocks.map((block) => ({
      ...block,
      invocation: {
        ...block.invocation,
        workingDirectory:
          block.invocation.workingDirectory === undefined
            ? resolve(defaultWorkingDirectory)
            : resolve(
                defaultWorkingDirectory,
                block.invocation.workingDirectory,
              ),
      },
    })),
  };
}

/**
 * Thin Electron-host adapter. The engine owns validation, DAG scheduling,
 * artifact routing, state transitions, and cancellation semantics. The node
 * runner owns child-process authority. This module only shapes sequenced engine
 * events into renderer-friendly snapshots.
 */
export function startWorkflowRun(
  workflow: WorkflowDefinition,
  onEvent: EventSink,
  options: StartWorkflowRunOptions = {},
): ActiveRun {
  const runId = options.runId ?? crypto.randomUUID();
  const controller = new AbortController();
  const snapshots = new Map<string, BlockRunSnapshot>(
    workflow.blocks.map((block) => [block.id, emptySnapshot(block.id)]),
  );
  const runInputs = canonicalizeNodeWorkflowRunInputs(
    workflow,
    options.runInputs,
    options.baseDirectory,
  );
  const runner = createDesktopProcessRunner(
    workflow,
    options.runner ??
      new NodeProcessRunner(
        options.baseDirectory === undefined
          ? {}
          : { baseDirectory: options.baseDirectory },
      ),
  );

  const execution = executeWorkflow(workflow, runner, {
    runId,
    signal: controller.signal,
    hostEnvironment: process.env,
    runInputs,
    onEvent: (event) => forwardEvent(event, snapshots, onEvent),
  });
  let completionEvent:
    Extract<DesktopRunEvent, { type: 'run_completed' }> | undefined;
  const completion = reportExecutionCompletion(execution, runId, (event) => {
    if (event.type === 'run_completed') completionEvent = event;
    else onEvent(event);
  }).then(async (result) => {
    let historyError: unknown;
    if (result !== undefined && options.onCompleted !== undefined) {
      try {
        await options.onCompleted({
          schemaVersion: 1,
          runId: result.runId,
          workflowId: result.workflowId,
          workflowName: workflow.name,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          outcome: result.outcome,
          blocks: [...snapshots.values()],
          runInputs: materializeEffectiveRunInputs(workflow, runInputs),
        });
      } catch (error) {
        historyError = error;
      }
    }
    const terminalEvent = completionEvent ?? {
      type: 'run_completed' as const,
      runId,
      outcome: 'failed' as const,
      endedAt: new Date().toISOString(),
      error: {
        code: 'execution_coordinator_failed' as const,
        message: 'Execution ended without a terminal runtime event.',
        nextAction: 'Review application logs and retry the workflow.',
      },
    };
    onEvent(
      historyError === undefined
        ? terminalEvent
        : {
            ...terminalEvent,
            error: {
              code: 'run_history_persistence_failed',
              message: `Run ${terminalEvent.outcome}, but its local history could not be retained: ${historyError instanceof Error ? historyError.message : String(historyError)}`,
              nextAction:
                'Check available disk space and application-data permissions, then run the workflow again.',
            },
          },
    );
  });

  return {
    runId,
    cancel: () => controller.abort(),
    completion,
  };
}

/**
 * Desktop-only result translation for specialized editors. The engine and node
 * runner continue to see only the generic process contract.
 */
export function createDesktopProcessRunner(
  workflow: WorkflowDefinition,
  delegate: ProcessRunner,
): ProcessRunner {
  const agentRuntimes = new Map(
    workflow.blocks.flatMap((block) => {
      const presentation = getAgentBlockPresentation(workflow, block.id);
      return presentation === undefined
        ? []
        : ([[block.id, presentation.agentRuntime]] as const);
    }),
  );

  return {
    async run(request, options): Promise<ProcessRunResult> {
      const result = await delegate.run(request, options);
      const runtime = agentRuntimes.get(request.blockId);
      return runtime === undefined
        ? result
        : translateAgentRuntimeResult(runtime, result);
    },
  };
}

export function materializeEffectiveRunInputs(
  workflow: WorkflowDefinition,
  runInputs: WorkflowRunInputs | undefined,
): WorkflowRunInputs {
  const values = Object.create(null) as Record<
    string,
    WorkflowRunInputs[string]
  >;
  for (const [inputId, resolved] of resolveWorkflowRunInputValues(
    workflow,
    runInputs,
  )) {
    values[inputId] = resolved.value;
  }
  return values;
}

function translateAgentRuntimeResult(
  runtime: AgentRuntimeId,
  result: ProcessRunResult,
): ProcessRunResult {
  if (
    result.status !== 'failed' ||
    result.failure.code !== 'process_exit_nonzero' ||
    !looksLikeAuthenticationFailure(
      `${result.stderr}\n${result.stdout}\n${result.failure.message}`,
    )
  ) {
    return result;
  }

  const guidance = runtimeAuthenticationGuidance(runtime);
  return {
    ...result,
    failure: {
      code: 'process_authentication_failed',
      message: `${guidance.label} could not authenticate with its local configuration.`,
      nextAction: guidance.nextAction,
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
    },
  };
}

function looksLikeAuthenticationFailure(diagnostics: string): boolean {
  return /(?:not (?:logged in|authenticated|signed in)|authentication (?:required|failed)|sign[ -]?in required|unauthorized|invalid api key|login required|codex login|cline auth|\b401\b)/i.test(
    diagnostics,
  );
}

function runtimeAuthenticationGuidance(runtime: AgentRuntimeId): {
  readonly label: string;
  readonly nextAction: string;
} {
  switch (runtime) {
    case 'codex':
      return {
        label: 'Codex CLI',
        nextAction:
          'Run `codex login` in a terminal, confirm `codex exec` works locally, then retry this workflow.',
      };
    case 'cline':
      return {
        label: 'Cline CLI',
        nextAction:
          'Run `cline auth` in a terminal, confirm a one-shot Cline prompt works locally, then retry this workflow.',
      };
    case 'antigravity':
      return {
        label: 'Antigravity CLI',
        nextAction:
          'Run `agy` in a terminal and complete its local sign-in flow, confirm `agy --print` works, then retry this workflow.',
      };
  }
}

function forwardEvent(
  event: RuntimeEvent,
  snapshots: Map<string, BlockRunSnapshot>,
  onEvent: EventSink,
): void {
  if (event.type === 'execution_started') {
    onEvent({
      type: 'run_started',
      runId: event.runId,
      startedAt: event.occurredAt,
      blocks: [...snapshots.values()],
    });
    return;
  }

  if (event.type === 'execution_completed') return;

  if (!('blockId' in event)) return;
  const current = snapshots.get(event.blockId) ?? emptySnapshot(event.blockId);
  const next = projectBlockRuntimeEvent(event, current);
  if (next === undefined) return;

  snapshots.set(event.blockId, next);
  onEvent({
    type: 'block_updated',
    runId: event.runId,
    block: next,
  });
}

export async function reportExecutionCompletion(
  execution: Promise<WorkflowExecutionResult>,
  runId: string,
  onEvent: EventSink,
): Promise<WorkflowExecutionResult | undefined> {
  try {
    const result = await execution;
    onEvent({
      type: 'run_completed',
      runId: result.runId,
      outcome: result.outcome,
      endedAt: result.completedAt,
    });
    return result;
  } catch (error) {
    onEvent({
      type: 'run_completed',
      runId,
      outcome: 'failed',
      endedAt: new Date().toISOString(),
      error: {
        code: 'execution_coordinator_failed',
        message: error instanceof Error ? error.message : String(error),
        nextAction:
          'Review workflow validation and application logs, then retry the run.',
      },
    });
    return undefined;
  }
}

export function projectBlockRuntimeEvent(
  event: RuntimeEvent,
  current: BlockRunSnapshot,
): BlockRunSnapshot | undefined {
  if (!('blockId' in event)) return undefined;
  let next = current;

  if (event.type === 'block_state_changed') {
    next = {
      ...current,
      state: event.to,
      ...(event.to === 'running' ? { startedAt: event.occurredAt } : {}),
      ...(isTerminal(event.to) ? { endedAt: event.occurredAt } : {}),
      ...(event.failure === undefined ? {} : { failure: event.failure }),
      ...(event.skipReason === undefined
        ? {}
        : { skipReason: event.skipReason.message }),
    };
  }
  if (event.type === 'block_inputs_resolved') {
    next = { ...current, inputs: event.inputs };
  }
  if (event.type === 'block_outputs_produced') {
    next = { ...current, artifacts: Object.values(event.outputs) };
  }
  if (event.type === 'block_stdout') {
    next = { ...current, stdout: `${current.stdout}${event.text}` };
  }
  if (event.type === 'block_stderr') {
    next = { ...current, stderr: `${current.stderr}${event.text}` };
  }
  if (event.type === 'block_completed') {
    next = {
      ...current,
      state: event.state,
      exitCode: event.exitCode,
      endedAt: event.occurredAt,
      ...(event.failure === undefined ? {} : { failure: event.failure }),
      ...(event.skipReason === undefined
        ? {}
        : { skipReason: event.skipReason.message }),
    };
  }

  return next;
}

function emptySnapshot(blockId: string): BlockRunSnapshot {
  return {
    blockId,
    state: 'queued',
    inputs: {} as Readonly<Record<string, Artifact>>,
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: null,
  };
}

function isTerminal(state: string): boolean {
  return (
    state === 'succeeded' ||
    state === 'failed' ||
    state === 'skipped' ||
    state === 'cancelled'
  );
}
