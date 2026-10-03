import type { Artifact } from './artifact.js';

export type BlockExecutionState =
  'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export type BlockTerminalState = Exclude<
  BlockExecutionState,
  'queued' | 'running'
>;

export type ExecutionFailureCode =
  | 'executable_not_found'
  | 'working_directory_not_found'
  | 'filesystem_reference_inaccessible'
  | 'invalid_json_output'
  | 'host_environment_variable_missing'
  | 'artifact_routing_failed'
  | 'process_launch_failed'
  | 'process_authentication_failed'
  | 'process_timeout'
  | 'process_exit_nonzero'
  | 'process_terminated_by_signal'
  | 'process_termination_failed';

export interface ExecutionFailure {
  readonly code: ExecutionFailureCode;
  readonly message: string;
  readonly nextAction?: string;
  readonly exitCode?: number;
  readonly signal?: string;
}

export type BlockSkipReasonCode = 'upstream_failed' | 'upstream_cancelled';

export interface BlockSkipReason {
  readonly code: BlockSkipReasonCode;
  readonly message: string;
  readonly upstreamBlockIds: readonly string[];
}

interface RuntimeEventBase {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
}

export type RuntimeEvent =
  | (RuntimeEventBase & {
      readonly type: 'execution_started';
      readonly workflowId: string;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_queued';
      readonly blockId: string;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_state_changed';
      readonly blockId: string;
      readonly from: BlockExecutionState;
      readonly to: BlockExecutionState;
      readonly failure?: ExecutionFailure;
      readonly skipReason?: BlockSkipReason;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_inputs_resolved';
      readonly blockId: string;
      readonly inputs: Readonly<Record<string, Artifact>>;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_outputs_produced';
      readonly blockId: string;
      readonly outputs: Readonly<Record<string, Artifact>>;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_completed';
      readonly blockId: string;
      readonly state: BlockTerminalState;
      readonly exitCode: number | null;
      readonly failure?: ExecutionFailure;
      readonly skipReason?: BlockSkipReason;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_stdout';
      readonly blockId: string;
      readonly text: string;
    })
  | (RuntimeEventBase & {
      readonly type: 'block_stderr';
      readonly blockId: string;
      readonly text: string;
    })
  | (RuntimeEventBase & {
      readonly type: 'execution_cancel_requested';
    })
  | (RuntimeEventBase & {
      readonly type: 'execution_completed';
      readonly outcome: 'succeeded' | 'failed' | 'cancelled';
    });
