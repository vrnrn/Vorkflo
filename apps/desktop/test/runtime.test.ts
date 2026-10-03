import { describe, expect, it, vi, type Mock } from 'vitest';
import type {
  ProcessRunRequest,
  ProcessRunner,
  RuntimeEvent,
  WorkflowExecutionResult,
} from '@vorkflo/engine';
import { ActiveRunRegistry } from '../src/main/run-registry';
import {
  applyDefaultWorkingDirectory,
  createDesktopProcessRunner,
  materializeEffectiveRunInputs,
  projectBlockRuntimeEvent,
  reportExecutionCompletion,
  resolveDesktopWorkflowBaseDirectory,
  startWorkflowRun,
  type ActiveRun,
} from '../src/main/runtime';
import { createProcessBlock, createWorkflow } from '../src/shared/defaults';
import {
  compileAgentBlock,
  setAgentBlockPresentation,
} from '../src/shared/agent-runtime';
import type {
  BlockRunSnapshot,
  DesktopRunEvent,
  RunHistoryRecord,
} from '../src/shared/contracts';

describe('desktop runtime projection', () => {
  it('resolves blank and relative working directories against the desktop base', () => {
    const explicit = createProcessBlock('explicit');
    const relative = createProcessBlock('relative');
    const workflow = {
      ...createWorkflow(),
      blocks: [
        createProcessBlock('default'),
        {
          ...explicit,
          invocation: {
            ...explicit.invocation,
            workingDirectory: '/explicit/project',
          },
        },
        {
          ...relative,
          invocation: {
            ...relative.invocation,
            workingDirectory: './nested/project',
          },
        },
      ],
    };

    const resolved = applyDefaultWorkingDirectory(workflow, '/workflow/home');

    expect(
      resolved.blocks.map((block) => block.invocation.workingDirectory),
    ).toEqual([
      '/workflow/home',
      '/explicit/project',
      '/workflow/home/nested/project',
    ]);
    expect(workflow.blocks[0]?.invocation.workingDirectory).toBeUndefined();
  });

  it('derives the desktop base directory from the workflow file or home', () => {
    expect(
      resolveDesktopWorkflowBaseDirectory(
        '/workspace/flows/example.vorkflo.json',
        '/Users/developer',
      ),
    ).toBe('/workspace/flows');
    expect(
      resolveDesktopWorkflowBaseDirectory(undefined, '/Users/developer'),
    ).toBe('/Users/developer');
    expect(() =>
      resolveDesktopWorkflowBaseDirectory(
        'relative/workflow.json',
        '/Users/developer',
      ),
    ).toThrow(/absolute/);
  });

  it('projects canonical block_completed details into the UI snapshot', () => {
    const event: RuntimeEvent = {
      type: 'block_completed',
      runId: 'run-1',
      sequence: 9,
      occurredAt: '2026-07-09T20:00:01.000Z',
      blockId: 'build',
      state: 'failed',
      exitCode: 2,
      failure: {
        code: 'process_exit_nonzero',
        message: 'Process exited with code 2.',
        exitCode: 2,
      },
    };

    expect(projectBlockRuntimeEvent(event, queuedSnapshot('build'))).toEqual(
      expect.objectContaining({
        blockId: 'build',
        state: 'failed',
        exitCode: 2,
        endedAt: event.occurredAt,
        failure: event.failure,
      }),
    );
  });

  it('turns unexpected coordinator rejection into one terminal event', async () => {
    const events: DesktopRunEvent[] = [];

    await reportExecutionCompletion(
      Promise.reject(new Error('coordinator exploded')),
      'run-failed',
      (event) => events.push(event),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'run_completed',
      runId: 'run-failed',
      outcome: 'failed',
      error: {
        code: 'execution_coordinator_failed',
        message: 'coordinator exploded',
      },
    });
  });

  it('forwards successful coordinator completion', async () => {
    const events: DesktopRunEvent[] = [];
    const result = {
      runId: 'run-ok',
      outcome: 'succeeded',
      completedAt: '2026-07-09T20:00:02.000Z',
    } as WorkflowExecutionResult;

    await reportExecutionCompletion(
      Promise.resolve(result),
      'run-ok',
      (event) => events.push(event),
    );

    expect(events).toEqual([
      {
        type: 'run_completed',
        runId: 'run-ok',
        outcome: 'succeeded',
        endedAt: result.completedAt,
      },
    ]);
    expect(
      await reportExecutionCompletion(
        Promise.resolve(result),
        'run-ok',
        () => undefined,
      ),
    ).toBe(result);
  });

  it('materializes explicit defaults for retained rerun inputs', () => {
    const workflow = {
      ...createWorkflow(),
      inputs: [
        {
          id: 'prompt',
          name: 'Prompt',
          artifactKind: 'text' as const,
          required: true,
          defaultValue: { kind: 'text' as const, value: 'saved default' },
        },
      ],
    };

    expect(materializeEffectiveRunInputs(workflow, undefined)).toEqual({
      prompt: { kind: 'text', value: 'saved default' },
    });
    expect(
      materializeEffectiveRunInputs(workflow, {
        prompt: { kind: 'text', value: 'manual value' },
      }),
    ).toEqual({ prompt: { kind: 'text', value: 'manual value' } });
  });

  it('canonicalizes relative filesystem run inputs for execution and retained reruns', async () => {
    const base = createProcessBlock('consumer');
    const block = {
      ...base,
      inputs: [
        {
          id: 'source',
          name: 'Source',
          artifactKind: 'filesystem-reference' as const,
          required: true,
        },
      ],
      outputs: [],
      invocation: {
        ...base.invocation,
        arguments: [{ type: 'input' as const, portId: 'source' }],
        outputs: [],
      },
    };
    const workflow = {
      ...createWorkflow(),
      inputs: [
        {
          id: 'source',
          name: 'Source',
          artifactKind: 'filesystem-reference' as const,
          required: true,
        },
      ],
      inputBindings: [
        {
          id: 'source-consumer',
          inputId: 'source',
          to: { blockId: 'consumer', portId: 'source' },
        },
      ],
      blocks: [block],
    };
    const supplied = {
      source: {
        kind: 'filesystem-reference' as const,
        path: './inputs/source.txt',
        entity: 'file' as const,
      },
    };
    let request: ProcessRunRequest | undefined;
    let retained: RunHistoryRecord | undefined;
    const runner: ProcessRunner = {
      async run(nextRequest) {
        request = nextRequest;
        return {
          status: 'succeeded',
          exitCode: 0,
          stdout: '',
          stderr: '',
          artifacts: [],
        };
      },
    };

    const run = startWorkflowRun(workflow, () => undefined, {
      baseDirectory: '/workflow/base',
      runInputs: supplied,
      runner,
      onCompleted(record) {
        retained = record;
      },
    });
    await run.completion;

    expect(request?.arguments).toEqual(['/workflow/base/inputs/source.txt']);
    expect(retained?.runInputs).toEqual({
      source: {
        kind: 'filesystem-reference',
        path: '/workflow/base/inputs/source.txt',
        entity: 'file',
      },
    });
    expect(supplied.source.path).toBe('./inputs/source.txt');
  });

  it('executes a Codex agent through an injected fake runner and retains effective inputs', async () => {
    const block = compileAgentBlock({
      id: 'agent',
      name: 'Agent',
      agentRuntime: 'codex',
      instruction: 'Answer exactly once.',
      textContext: { portId: 'context', name: 'Context' },
      authority: 'read-only',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
    });
    const workflow = setAgentBlockPresentation(
      {
        ...createWorkflow(),
        inputs: [
          {
            id: 'context',
            name: 'Context',
            artifactKind: 'text',
            required: true,
            defaultValue: {
              kind: 'text',
              value: 'retained default context',
            },
          },
        ],
        inputBindings: [
          {
            id: 'context-agent',
            inputId: 'context',
            to: { blockId: 'agent', portId: 'context' },
          },
        ],
        blocks: [block],
      },
      block.id,
      'codex',
    );
    let request: ProcessRunRequest | undefined;
    const fakeRunner: ProcessRunner = {
      async run(nextRequest) {
        request = nextRequest;
        return {
          status: 'succeeded',
          exitCode: 0,
          stdout: 'fake response',
          stderr: 'fake progress',
          artifacts: [
            {
              id: 'fake-response',
              kind: 'text',
              value: 'fake response',
              provenance: {
                runId: nextRequest.runId,
                blockId: nextRequest.blockId,
                portId: 'response',
                createdAt: '2026-07-09T12:00:00.000Z',
              },
            },
          ],
        };
      },
    };
    let retained: RunHistoryRecord | undefined;
    const completionOrder: string[] = [];

    const run = startWorkflowRun(
      workflow,
      (event) => {
        if (event.type === 'run_completed') completionOrder.push('event');
      },
      {
        runner: fakeRunner,
        onCompleted(record) {
          completionOrder.push('history');
          retained = record;
        },
      },
    );
    await run.completion;

    expect(request?.executable).toBe('codex');
    expect(request?.shell).toBe(false);
    expect(request?.stdin).toBe('retained default context');
    expect(request?.arguments).toEqual([
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      'Answer exactly once.',
    ]);
    expect(retained?.blocks[0]).toMatchObject({
      blockId: 'agent',
      state: 'succeeded',
      stdout: 'fake response',
      stderr: 'fake progress',
    });
    expect(retained?.runInputs).toEqual({
      context: { kind: 'text', value: 'retained default context' },
    });
    expect(completionOrder).toEqual(['history', 'event']);
  });

  it('routes a fake Codex filesystem output into a downstream generic block', async () => {
    const generatedPath = '/workspace/project/generated/report.md';
    const agent = compileAgentBlock({
      id: 'agent-files',
      name: 'Generate report',
      agentRuntime: 'codex',
      instruction: 'Create generated/report.md.',
      workingDirectory: '/workspace/project',
      authority: 'workspace-write',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'report',
          name: 'Report',
          path: './generated/report.md',
          entity: 'file',
        },
      ],
    });
    const consumerBase = createProcessBlock('consumer', 'Consume report');
    const consumer = {
      ...consumerBase,
      inputs: [
        {
          id: 'report',
          name: 'Report',
          artifactKind: 'filesystem-reference' as const,
          required: true,
        },
      ],
      invocation: {
        ...consumerBase.invocation,
        arguments: [{ type: 'input' as const, portId: 'report' }],
      },
    };
    const workflow = setAgentBlockPresentation(
      {
        ...createWorkflow(),
        blocks: [agent, consumer],
        connections: [
          {
            id: 'agent-report-to-consumer',
            from: { blockId: agent.id, portId: 'report' },
            to: { blockId: consumer.id, portId: 'report' },
          },
        ],
        layout: {
          blockPositions: {
            [agent.id]: { x: 120, y: 120 },
            [consumer.id]: { x: 520, y: 120 },
          },
        },
      },
      agent.id,
      'codex',
    );
    const requests: ProcessRunRequest[] = [];
    const fakeRunner: ProcessRunner = {
      async run(request) {
        requests.push(request);
        if (request.blockId === agent.id) {
          return {
            status: 'succeeded',
            exitCode: 0,
            stdout: 'Created the report.',
            stderr: 'fake Codex progress',
            artifacts: [
              {
                id: 'fake-agent-response',
                kind: 'text',
                value: 'Created the report.',
                provenance: {
                  runId: request.runId,
                  blockId: request.blockId,
                  portId: 'response',
                  createdAt: '2026-07-09T12:00:00.000Z',
                },
              },
              {
                id: 'fake-agent-report',
                kind: 'filesystem-reference',
                path: generatedPath,
                entity: 'file',
                provenance: {
                  runId: request.runId,
                  blockId: request.blockId,
                  portId: 'report',
                  createdAt: '2026-07-09T12:00:00.000Z',
                },
              },
            ],
          };
        }
        return {
          status: 'succeeded',
          exitCode: 0,
          stdout: 'consumed',
          stderr: '',
          artifacts: [
            {
              id: 'fake-consumer-output',
              kind: 'text',
              value: 'consumed',
              provenance: {
                runId: request.runId,
                blockId: request.blockId,
                portId: 'stdout',
                createdAt: '2026-07-09T12:00:01.000Z',
              },
            },
          ],
        };
      },
    };
    let retained: RunHistoryRecord | undefined;

    const run = startWorkflowRun(workflow, () => undefined, {
      runner: fakeRunner,
      onCompleted(record) {
        retained = record;
      },
    });
    await run.completion;

    expect(requests.map((request) => request.blockId)).toEqual([
      'agent-files',
      'consumer',
    ]);
    expect(requests[0]?.outputs).toContainEqual({
      portId: 'report',
      kind: 'filesystem-reference',
      path: './generated/report.md',
      entity: 'file',
    });
    expect(requests[1]?.arguments).toEqual([generatedPath]);
    expect(
      retained?.blocks.find((block) => block.blockId === agent.id),
    ).toMatchObject({
      state: 'succeeded',
      artifacts: [
        expect.objectContaining({ kind: 'text', value: 'Created the report.' }),
        expect.objectContaining({
          kind: 'filesystem-reference',
          path: generatedPath,
          entity: 'file',
        }),
      ],
    });
    expect(
      retained?.blocks.find((block) => block.blockId === consumer.id),
    ).toMatchObject({
      state: 'succeeded',
      inputs: {
        report: expect.objectContaining({
          kind: 'filesystem-reference',
          path: generatedPath,
        }),
      },
    });
  });

  it('reports an actionable warning when local history persistence fails', async () => {
    const workflow = {
      ...createWorkflow(),
      blocks: [
        {
          ...createProcessBlock('no-output'),
          outputs: [],
          invocation: {
            ...createProcessBlock('no-output').invocation,
            outputs: [],
          },
        },
      ],
    };
    const events: DesktopRunEvent[] = [];
    const runner: ProcessRunner = {
      async run() {
        return {
          status: 'succeeded',
          exitCode: 0,
          stdout: '',
          stderr: '',
          artifacts: [],
        };
      },
    };

    const run = startWorkflowRun(workflow, (event) => events.push(event), {
      runner,
      onCompleted: async () => {
        throw new Error('disk full');
      },
    });
    await run.completion;

    expect(events.at(-1)).toMatchObject({
      type: 'run_completed',
      outcome: 'succeeded',
      error: {
        code: 'run_history_persistence_failed',
        message: expect.stringContaining('disk full'),
      },
    });
  });

  it.each([
    ['codex', 'Not logged in. Run codex login.', 'codex login'],
    ['cline', 'Authentication required. Run cline auth.', 'cline auth'],
    ['antigravity', 'Sign-in required for this session.', 'agy --print'],
  ] as const)(
    'translates %s authentication diagnostics without provider behavior in the engine',
    async (runtime, diagnostics, expectedGuidance) => {
      const workflow = setAgentBlockPresentation(
        {
          ...createWorkflow(),
          blocks: [createProcessBlock('agent')],
        },
        'agent',
        runtime,
      );
      const delegate: ProcessRunner = {
        async run() {
          return {
            status: 'failed',
            exitCode: 1,
            stdout: '',
            stderr: diagnostics,
            artifacts: [],
            failure: {
              code: 'process_exit_nonzero',
              message: 'Process exited with code 1.',
              exitCode: 1,
            },
          };
        },
      };

      const result = await createDesktopProcessRunner(workflow, delegate).run(
        {
          runId: 'run-auth',
          blockId: 'agent',
          executable: 'not-used-for-identification',
          arguments: [],
          shell: false,
          environment: {},
          outputs: [],
        },
        { signal: new AbortController().signal },
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.failure).toMatchObject({
          code: 'process_authentication_failed',
          exitCode: 1,
        });
        expect(result.failure.nextAction).toContain(expectedGuidance);
      }
    },
  );
});

describe('active run registry', () => {
  it.each(['resolve', 'reject'] as const)(
    'cleans up tracked runs after completion %s',
    async (settlement) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const completion = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const run: ActiveRun = {
        runId: `run-${settlement}`,
        cancel: vi.fn(),
        completion,
      };
      const registry = new ActiveRunRegistry();

      registry.track(run);
      expect(registry.size).toBe(1);
      if (settlement === 'resolve') resolve();
      else reject(new Error('failed'));
      await completion.catch(() => undefined);
      await Promise.resolve();

      expect(registry.size).toBe(0);
    },
  );

  it('cancels one run or every active run', () => {
    const first = fakeRun('first');
    const second = fakeRun('second');
    const registry = new ActiveRunRegistry();
    registry.track(first);
    registry.track(second);

    registry.cancel('first');
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(second.cancel).not.toHaveBeenCalled();

    registry.cancelAll();
    expect(first.cancel).toHaveBeenCalledTimes(2);
    expect(second.cancel).toHaveBeenCalledOnce();
  });
});

function queuedSnapshot(blockId: string): BlockRunSnapshot {
  return {
    blockId,
    state: 'queued',
    inputs: {},
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: null,
  };
}

function fakeRun(runId: string): ActiveRun & { cancel: Mock<() => void> } {
  return {
    runId,
    cancel: vi.fn(),
    completion: new Promise(() => undefined),
  };
}
