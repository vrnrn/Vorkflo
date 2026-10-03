import type {
  Artifact,
  BlockExecutionState,
  ExecutionFailure,
  WorkflowPreflightResult,
  WorkflowDefinition,
  WorkflowRunInputs,
} from '@vorkflo/engine';

export interface WorkflowFileResult {
  readonly canceled: boolean;
  readonly filePath?: string;
  readonly workflow?: WorkflowDefinition;
}

export interface SaveWorkflowRequest {
  readonly workflow: WorkflowDefinition;
  readonly filePath?: string;
  readonly saveAs?: boolean;
}

export interface SaveWorkflowResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface SelectFilesystemPathRequest {
  readonly kind: 'file' | 'directory' | 'output-file';
  readonly defaultPath?: string;
}

export interface SelectFilesystemPathResult {
  readonly canceled: boolean;
  readonly path?: string;
}

export interface UserToolModelCatalog {
  readonly default?: string;
  readonly models: readonly string[];
}

export interface UserCodexIntelligenceProfile {
  readonly name: string;
  readonly model: string;
  readonly reasoningEffort: string;
}

export interface UserCodexModelCatalog extends UserToolModelCatalog {
  /** User-owned labels that resolve to exact visible invocation settings. */
  readonly intelligenceProfiles?: readonly UserCodexIntelligenceProfile[];
}

export interface UserModelCatalog {
  readonly schemaVersion: 1;
  readonly codex: UserCodexModelCatalog;
  readonly cline: UserToolModelCatalog;
  readonly agy: UserToolModelCatalog;
}

export interface UserModelCatalogResult {
  readonly filePath: string;
  readonly catalog: UserModelCatalog;
  readonly issue?: string;
}

export interface BlockRunSnapshot {
  readonly blockId: string;
  readonly state: BlockExecutionState;
  readonly inputs: Readonly<Record<string, Artifact>>;
  readonly artifacts: readonly Artifact[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly failure?: ExecutionFailure;
  readonly skipReason?: string;
}

export interface RunHistoryRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: 'succeeded' | 'failed' | 'cancelled';
  readonly blocks: readonly BlockRunSnapshot[];
  readonly runInputs: WorkflowRunInputs;
  readonly worktrees?: readonly WorktreeRunRecord[];
}

export interface WorktreeRunRecord {
  readonly scopeId: string;
  readonly repositoryRoot: string;
  readonly baseCommit: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly createdAt: string;
  readonly sourceIsDirty: boolean;
  readonly state: 'retained' | 'cleaned';
  readonly reason: string;
  readonly status: string;
  readonly headCommit: string;
  readonly hasChangesFromBase: boolean;
  readonly nextAction: string;
}

export interface WorktreeInspectionResult {
  readonly status: string;
  readonly diff: string;
  readonly headCommit: string;
  readonly hasUncommittedChanges: boolean;
  readonly hasChangesFromBase: boolean;
}

export type DesktopRunEvent =
  | {
      readonly type: 'run_started';
      readonly runId: string;
      readonly startedAt: string;
      readonly blocks: readonly BlockRunSnapshot[];
    }
  | {
      readonly type: 'block_updated';
      readonly runId: string;
      readonly block: BlockRunSnapshot;
    }
  | {
      readonly type: 'run_completed';
      readonly runId: string;
      readonly outcome: 'succeeded' | 'failed' | 'cancelled';
      readonly endedAt: string;
      readonly error?: {
        readonly code:
          'execution_coordinator_failed' | 'run_history_persistence_failed';
        readonly message: string;
        readonly nextAction: string;
      };
    };

export interface RunWorkflowResult {
  readonly runId: string;
}

export interface RunWorkflowRequest {
  readonly runId?: string;
  readonly workflow: WorkflowDefinition;
  readonly runInputs: WorkflowRunInputs;
  readonly workflowFilePath?: string;
}

export type PreflightWorkflowRequest = RunWorkflowRequest;

export interface VorkfloBridge {
  getUserModelCatalog(): Promise<UserModelCatalogResult>;
  openWorkflow(): Promise<WorkflowFileResult>;
  saveWorkflow(request: SaveWorkflowRequest): Promise<SaveWorkflowResult>;
  selectFilesystemPath(
    request: SelectFilesystemPathRequest,
  ): Promise<SelectFilesystemPathResult>;
  openFilesystemPath(path: string): Promise<void>;
  revealFilesystemPath(path: string): Promise<void>;
  listRunHistory(workflowId: string): Promise<readonly RunHistoryRecord[]>;
  clearRunHistory(workflowId: string): Promise<void>;
  inspectRunWorktree(
    runId: string,
    scopeId: string,
  ): Promise<WorktreeInspectionResult>;
  cleanupRunWorktree(
    runId: string,
    scopeId: string,
  ): Promise<WorktreeRunRecord>;
  preflightWorkflow(
    request: PreflightWorkflowRequest,
  ): Promise<WorkflowPreflightResult>;
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowResult>;
  cancelRun(runId: string): Promise<void>;
  onRunEvent(listener: (event: DesktopRunEvent) => void): () => void;
}

export const IPC_CHANNELS = {
  getUserModelCatalog: 'settings:model-catalog',
  openWorkflow: 'workflow:open',
  saveWorkflow: 'workflow:save',
  selectFilesystemPath: 'filesystem:select',
  openFilesystemPath: 'filesystem:open',
  revealFilesystemPath: 'filesystem:reveal',
  listRunHistory: 'run-history:list',
  clearRunHistory: 'run-history:clear',
  inspectRunWorktree: 'run-history:worktree-inspect',
  cleanupRunWorktree: 'run-history:worktree-cleanup',
  preflightWorkflow: 'run:preflight',
  runWorkflow: 'run:start',
  cancelRun: 'run:cancel',
  runEvent: 'run:event',
} as const;
