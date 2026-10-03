import type { WorkflowDefinition, WorkflowRunInputs } from './schema.js';
import {
  validateWorkflowRunInputs,
  type RunInputIssue,
  type RunInputIssueCode,
} from './run-inputs.js';
import {
  validateWorkflow,
  type ValidationIssue,
  type ValidationIssueCode,
} from './validation.js';

export type PreflightIssueSeverity = 'blocker' | 'warning';

export type PreflightIssueCode =
  | ValidationIssueCode
  | RunInputIssueCode
  | `adapter_${string}`
  | 'preflight_adapter_failed';

export interface PreflightIssue {
  readonly severity: PreflightIssueSeverity;
  readonly code: PreflightIssueCode;
  readonly message: string;
  readonly path: string;
  readonly field: string;
  readonly blockId?: string;
}

export interface ResolvedFilesystemOutputPreview {
  readonly portId: string;
  readonly path: string;
  readonly entity: 'file' | 'directory' | 'unknown';
}

export interface BlockPreflightPreview {
  readonly blockId: string;
  readonly executable: string;
  readonly resolvedExecutable?: string;
  readonly workingDirectory: string;
  readonly shell: boolean;
  readonly timeoutMs?: number;
  readonly outputs: readonly ResolvedFilesystemOutputPreview[];
}

export interface PreflightAdapterOptions {
  readonly hostEnvironment: Readonly<Record<string, string | undefined>>;
  readonly runInputs?: WorkflowRunInputs;
}

export interface PreflightAdapterResult {
  readonly issues: readonly PreflightIssue[];
  readonly blocks: readonly BlockPreflightPreview[];
}

export interface WorkflowPreflightAdapter {
  preflight(
    workflow: WorkflowDefinition,
    options: PreflightAdapterOptions,
  ): Promise<PreflightAdapterResult>;
}

export interface WorkflowPreflightOptions extends PreflightAdapterOptions {}

export interface WorkflowPreflightResult {
  readonly ready: boolean;
  readonly issues: readonly PreflightIssue[];
  readonly blocks: readonly BlockPreflightPreview[];
}

export async function preflightWorkflow(
  workflow: WorkflowDefinition,
  adapter: WorkflowPreflightAdapter,
  options: WorkflowPreflightOptions = { hostEnvironment: {} },
): Promise<WorkflowPreflightResult> {
  const issues: PreflightIssue[] = validateWorkflow(workflow).issues.map(
    (issue) => validationIssueToPreflight(workflow, issue),
  );
  issues.push(
    ...validateWorkflowRunInputs(workflow, options.runInputs).issues.map(
      runInputIssueToPreflight,
    ),
  );

  let adapterResult: PreflightAdapterResult = { issues: [], blocks: [] };
  try {
    adapterResult = await adapter.preflight(workflow, options);
  } catch (error) {
    issues.push({
      severity: 'blocker',
      code: 'preflight_adapter_failed',
      message: error instanceof Error ? error.message : String(error),
      path: 'workflow',
      field: 'workflow',
    });
  }
  issues.push(...adapterResult.issues);

  return {
    ready: !issues.some((issue) => issue.severity === 'blocker'),
    issues,
    blocks: adapterResult.blocks,
  };
}

function validationIssueToPreflight(
  workflow: WorkflowDefinition,
  issue: ValidationIssue,
): PreflightIssue {
  const blockMatch = /^blocks\[(\d+)](?:\.(.*))?$/.exec(issue.path);
  if (blockMatch !== null) {
    const blockIndex = Number(blockMatch[1]);
    const blockId = workflow.blocks[blockIndex]?.id;
    return {
      severity: 'blocker',
      code: issue.code,
      message: issue.message,
      path: issue.path,
      field: blockMatch[2] ?? 'block',
      ...(blockId === undefined ? {} : { blockId }),
    };
  }

  const bindingMatch = /^inputBindings\[(\d+)](?:\.(.*))?$/.exec(issue.path);
  if (bindingMatch !== null) {
    const bindingIndex = Number(bindingMatch[1]);
    const blockId = workflow.inputBindings[bindingIndex]?.to.blockId;
    return {
      severity: 'blocker',
      code: issue.code,
      message: issue.message,
      path: issue.path,
      field: bindingMatch[2] ?? 'inputBinding',
      ...(blockId === undefined ? {} : { blockId }),
    };
  }

  const connectionMatch = /^connections\[(\d+)](?:\.(.*))?$/.exec(issue.path);
  if (connectionMatch !== null) {
    const connectionIndex = Number(connectionMatch[1]);
    const connection = workflow.connections[connectionIndex];
    const sourceExists = workflow.blocks.some(
      (block) => block.id === connection?.from.blockId,
    );
    const targetExists = workflow.blocks.some(
      (block) => block.id === connection?.to.blockId,
    );
    const sourceIssue =
      issue.code === 'missing_source_port' ||
      issue.code === 'missing_target_block';
    const preferredBlockId = sourceIssue
      ? connection?.from.blockId
      : connection?.to.blockId;
    const preferredExists = sourceIssue ? sourceExists : targetExists;
    const fallbackBlockId = sourceIssue
      ? connection?.to.blockId
      : connection?.from.blockId;
    const fallbackExists = sourceIssue ? targetExists : sourceExists;
    const blockId = preferredExists
      ? preferredBlockId
      : fallbackExists
        ? fallbackBlockId
        : undefined;
    const field = preferredExists
      ? sourceIssue
        ? 'outputs'
        : 'inputs'
      : fallbackExists
        ? sourceIssue
          ? 'inputs'
          : 'outputs'
        : (connectionMatch[2] ?? 'connection');
    return {
      severity: 'blocker',
      code: issue.code,
      message: issue.message,
      path: issue.path,
      field,
      ...(blockId === undefined ? {} : { blockId }),
    };
  }

  return {
    severity: 'blocker',
    code: issue.code,
    message: issue.message,
    path: issue.path,
    field: issue.path,
  };
}

function runInputIssueToPreflight(issue: RunInputIssue): PreflightIssue {
  return {
    severity: 'blocker',
    code: issue.code,
    message: issue.message,
    path: issue.path,
    field: issue.path,
  };
}
