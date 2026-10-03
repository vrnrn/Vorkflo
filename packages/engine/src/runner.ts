import type { Artifact } from './artifact.js';
import type { ExecutionFailure } from './runtime.js';

export type ProcessOutputSpec =
  | {
      readonly portId: string;
      readonly kind: 'text' | 'json';
      readonly source: 'stdout' | 'stderr';
    }
  | {
      readonly portId: string;
      readonly kind: 'filesystem-reference';
      readonly path: string;
      readonly entity?: 'file' | 'directory' | 'unknown';
    };

export interface ProcessRunRequest {
  readonly runId: string;
  readonly blockId: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly shell: boolean;
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly outputs: readonly ProcessOutputSpec[];
}

interface ProcessRunResultBase {
  readonly stdout: string;
  readonly stderr: string;
  readonly artifacts: readonly Artifact[];
}

export type ProcessRunResult =
  | (ProcessRunResultBase & {
      readonly status: 'succeeded';
      readonly exitCode: 0;
    })
  | (ProcessRunResultBase & {
      readonly status: 'failed';
      readonly exitCode: number | null;
      readonly failure: ExecutionFailure;
    })
  | (ProcessRunResultBase & {
      readonly status: 'cancelled';
      readonly exitCode: number | null;
    });

export interface ProcessRunner {
  run(
    request: ProcessRunRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ProcessRunResult>;
}
