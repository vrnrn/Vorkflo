import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

import {
  resolveWorkflowRunInputValues,
  type BlockPreflightPreview,
  type PreflightAdapterOptions,
  type PreflightIssue,
  type WorkflowDefinition,
  type WorkflowPreflightAdapter,
  type WorkflowRunInputValue,
} from '@vorkflo/engine';

import {
  resolveProcessExecutableCandidates,
  resolveProcessFilesystemPath,
  resolveProcessWorkingDirectory,
} from './path-resolution.js';
import { canonicalizeNodeWorkflowRunInputs } from './run-inputs.js';

interface PathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface NodePreflightOptions {
  readonly baseDirectory?: string;
  readonly statPath?: (path: string) => Promise<PathMetadata>;
  readonly accessPath?: (path: string, mode: number) => Promise<void>;
}

const SHELL_ONLY_SYNTAX = /(?:&&|\|\||[|<>;`]|\$\()/;
const DESTRUCTIVE_OUTPUT_LOCATIONS = new Set([
  '/',
  '/Applications',
  '/Library',
  '/System',
  '/bin',
  '/etc',
  '/private',
  '/sbin',
  '/usr',
]);

export class NodeWorkflowPreflight implements WorkflowPreflightAdapter {
  readonly #baseDirectory: string;
  readonly #statPath: (path: string) => Promise<PathMetadata>;
  readonly #accessPath: (path: string, mode: number) => Promise<void>;

  constructor(options: NodePreflightOptions = {}) {
    this.#baseDirectory = resolveProcessWorkingDirectory(options.baseDirectory);
    this.#statPath = options.statPath ?? stat;
    this.#accessPath = options.accessPath ?? access;
  }

  async preflight(
    workflow: WorkflowDefinition,
    options: PreflightAdapterOptions,
  ): Promise<{
    readonly issues: readonly PreflightIssue[];
    readonly blocks: readonly BlockPreflightPreview[];
  }> {
    const issues: PreflightIssue[] = [];
    const blocks: BlockPreflightPreview[] = [];
    let resolvedRunInputs: ReadonlyMap<
      string,
      { readonly value: WorkflowRunInputValue }
    > = new Map();
    try {
      const canonicalInputs = canonicalizeNodeWorkflowRunInputs(
        workflow,
        options.runInputs,
        this.#baseDirectory,
      );
      resolvedRunInputs = resolveWorkflowRunInputValues(
        workflow,
        canonicalInputs,
      );
    } catch {
      // The engine coordinator reports malformed, missing, and mismatched values.
    }

    await this.#inspectFilesystemRunInputs(resolvedRunInputs, issues);
    const workflowValuesByBlock = collectWorkflowValuesByBlock(
      workflow,
      resolvedRunInputs,
    );

    for (const [blockIndex, block] of workflow.blocks.entries()) {
      const workingDirectory = resolveProcessWorkingDirectory(
        block.invocation.workingDirectory,
        this.#baseDirectory,
      );
      const outputPreviews = block.invocation.outputs.flatMap((output) =>
        output.type === 'filesystem'
          ? [
              {
                portId: output.portId,
                path: resolveProcessFilesystemPath(
                  output.path,
                  workingDirectory,
                  this.#baseDirectory,
                ),
                entity: output.entity ?? 'unknown',
              } as const,
            ]
          : [],
      );

      if (block.invocation.shell) {
        issues.push(
          blockIssue(
            blockIndex,
            block.id,
            'invocation.shell',
            'adapter_shell_mode',
            'warning',
            'Shell evaluation is enabled; expansion, pipes, and redirects may change process authority.',
          ),
        );
      } else {
        const shellSyntaxField = findShellOnlySyntaxField(block);
        if (shellSyntaxField !== undefined) {
          issues.push(
            blockIssue(
              blockIndex,
              block.id,
              shellSyntaxField,
              'adapter_shell_syntax_literal',
              'warning',
              'Shell-only syntax is present in a direct invocation and will be passed as literal text.',
            ),
          );
        }
      }

      const environment = resolveEnvironment(
        workflowValuesByBlock.get(block.id),
        blockIndex,
        block.id,
        block.invocation.environment,
        options.hostEnvironment,
        issues,
      );
      const workingDirectoryUsable = await this.#inspectWorkingDirectory(
        workingDirectory,
        blockIndex,
        block.id,
        issues,
      );
      const resolvedExecutable = block.invocation.shell
        ? undefined
        : await this.#inspectExecutable(
            block.invocation.executable,
            environment,
            workingDirectory,
            workingDirectoryUsable,
            blockIndex,
            block.id,
            issues,
          );

      for (const output of outputPreviews) {
        const bindingIndex = block.invocation.outputs.findIndex(
          (binding) =>
            binding.type === 'filesystem' && binding.portId === output.portId,
        );
        await this.#inspectFilesystemOutput(
          output.path,
          output.entity,
          blockIndex,
          block.id,
          bindingIndex,
          issues,
        );
      }

      blocks.push({
        blockId: block.id,
        executable: block.invocation.executable,
        ...(resolvedExecutable === undefined ? {} : { resolvedExecutable }),
        workingDirectory,
        shell: block.invocation.shell,
        ...(block.invocation.timeoutMs === undefined
          ? {}
          : { timeoutMs: block.invocation.timeoutMs }),
        outputs: outputPreviews,
      });
    }

    return { issues, blocks };
  }

  async #inspectFilesystemRunInputs(
    runInputs: ReadonlyMap<string, { readonly value: WorkflowRunInputValue }>,
    issues: PreflightIssue[],
  ): Promise<void> {
    for (const [inputId, resolvedInput] of runInputs.entries()) {
      const input = resolvedInput.value;
      if (input.kind !== 'filesystem-reference') continue;
      const path = isAbsolute(input.path)
        ? resolve(input.path)
        : resolve(this.#baseDirectory, input.path);
      let metadata: PathMetadata;
      try {
        metadata = await this.#statPath(path);
        await this.#accessPath(
          path,
          metadata.isDirectory()
            ? constants.R_OK | constants.X_OK
            : constants.R_OK,
        );
      } catch {
        issues.push({
          severity: 'blocker',
          code: 'adapter_filesystem_input_inaccessible',
          message: `Filesystem workflow input "${inputId}" is missing or inaccessible: ${path}`,
          path: `runInputs.${inputId}`,
          field: `runInputs.${inputId}`,
        });
        continue;
      }
      const actualEntity = metadata.isFile()
        ? 'file'
        : metadata.isDirectory()
          ? 'directory'
          : 'unknown';
      if (actualEntity === 'unknown') {
        issues.push({
          severity: 'blocker',
          code: 'adapter_filesystem_input_unsupported_entity',
          message: `Filesystem workflow input "${inputId}" is neither a regular file nor a directory: ${path}`,
          path: `runInputs.${inputId}`,
          field: `runInputs.${inputId}`,
        });
        continue;
      }
      if (
        input.entity !== undefined &&
        input.entity !== 'unknown' &&
        actualEntity !== input.entity
      ) {
        issues.push({
          severity: 'blocker',
          code: 'adapter_filesystem_input_entity_mismatch',
          message: `Filesystem workflow input "${inputId}" expected a ${input.entity}, but found ${actualEntity}: ${path}`,
          path: `runInputs.${inputId}`,
          field: `runInputs.${inputId}`,
        });
      }
    }
  }

  async #inspectWorkingDirectory(
    path: string,
    blockIndex: number,
    blockId: string,
    issues: PreflightIssue[],
  ): Promise<boolean> {
    try {
      const metadata = await this.#statPath(path);
      if (!metadata.isDirectory()) throw new Error('not a directory');
      await this.#accessPath(path, constants.R_OK | constants.X_OK);
      return true;
    } catch {
      issues.push(
        blockIssue(
          blockIndex,
          blockId,
          'invocation.workingDirectory',
          'adapter_working_directory_inaccessible',
          'blocker',
          `Working directory is missing, inaccessible, or not a directory: ${path}`,
        ),
      );
      return false;
    }
  }

  async #inspectExecutable(
    executable: string,
    environment: Readonly<Record<string, string>>,
    workingDirectory: string,
    workingDirectoryUsable: boolean,
    blockIndex: number,
    blockId: string,
    issues: PreflightIssue[],
  ): Promise<string | undefined> {
    const explicitPath =
      isAbsolute(executable) ||
      executable.includes('/') ||
      executable.includes('\\');
    const pathValue = environment.PATH;
    if (!explicitPath && pathValue === undefined) {
      issues.push(
        blockIssue(
          blockIndex,
          blockId,
          'invocation.executable',
          'adapter_executable_path_unavailable',
          'blocker',
          `Cannot resolve executable "${executable}" because PATH is not available through the block's declared environment.`,
        ),
      );
      return undefined;
    }

    if (explicitPath && !isAbsolute(executable) && !workingDirectoryUsable) {
      return undefined;
    }
    const candidates = resolveProcessExecutableCandidates(
      executable,
      workingDirectory,
      pathValue,
    );
    for (const candidate of candidates) {
      if (await this.#isExecutableFile(candidate)) return candidate;
    }
    issues.push(
      executableIssue(
        blockIndex,
        blockId,
        explicitPath
          ? `Executable was not found or is not executable: ${candidates[0] ?? executable}`
          : `Executable was not found in the block's declared PATH: ${executable}`,
      ),
    );
    return undefined;
  }

  async #isExecutableFile(path: string): Promise<boolean> {
    try {
      const metadata = await this.#statPath(path);
      if (!metadata.isFile()) return false;
      await this.#accessPath(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async #inspectFilesystemOutput(
    path: string,
    entity: 'file' | 'directory' | 'unknown',
    blockIndex: number,
    blockId: string,
    bindingIndex: number,
    issues: PreflightIssue[],
  ): Promise<void> {
    const field = `invocation.outputs[${bindingIndex}].path`;
    if (isDestructiveOutputPath(path)) {
      issues.push(
        blockIssue(
          blockIndex,
          blockId,
          field,
          'adapter_destructive_output_path',
          'warning',
          `Filesystem output targets a sensitive system location: ${path}`,
        ),
      );
    }

    let current = path;
    while (true) {
      try {
        const metadata = await this.#statPath(current);
        if (current === path) {
          const actualEntity = metadata.isFile()
            ? 'file'
            : metadata.isDirectory()
              ? 'directory'
              : 'unknown';
          if (actualEntity === 'unknown') {
            issues.push(
              blockIssue(
                blockIndex,
                blockId,
                field,
                'adapter_filesystem_output_unsupported_entity',
                'blocker',
                `Filesystem output is neither a regular file nor a directory: ${path}`,
              ),
            );
            return;
          }
          if (entity !== 'unknown' && actualEntity !== entity) {
            issues.push(
              blockIssue(
                blockIndex,
                blockId,
                field,
                'adapter_filesystem_output_entity_mismatch',
                'blocker',
                `Filesystem output expected a ${entity}, but found ${actualEntity}: ${path}`,
              ),
            );
            return;
          }
        }
        if (!metadata.isDirectory() && current !== path) {
          throw new Error('nearest existing parent is not a directory');
        }
        await this.#accessPath(
          current,
          metadata.isDirectory()
            ? constants.W_OK | constants.X_OK
            : constants.W_OK,
        );
        return;
      } catch (error) {
        if (isMissingPathError(error) && current !== dirname(current)) {
          current = dirname(current);
          continue;
        }
        issues.push(
          blockIssue(
            blockIndex,
            blockId,
            field,
            'adapter_filesystem_output_parent_inaccessible',
            'blocker',
            `Filesystem output has no accessible writable target or parent: ${path}`,
          ),
        );
        return;
      }
    }
  }
}

function collectWorkflowValuesByBlock(
  workflow: WorkflowDefinition,
  runInputs: ReadonlyMap<string, { readonly value: WorkflowRunInputValue }>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const values = new Map<string, Map<string, string>>();
  for (const binding of workflow.inputBindings) {
    const input = runInputs.get(binding.inputId)?.value;
    if (input === undefined) continue;
    let blockValues = values.get(binding.to.blockId);
    if (blockValues === undefined) {
      blockValues = new Map();
      values.set(binding.to.blockId, blockValues);
    }
    blockValues.set(binding.to.portId, workflowInputToString(input));
  }
  return values;
}

function resolveEnvironment(
  workflowValues: ReadonlyMap<string, string> | undefined,
  blockIndex: number,
  blockId: string,
  bindings: WorkflowDefinition['blocks'][number]['invocation']['environment'],
  hostEnvironment: Readonly<Record<string, string | undefined>>,
  issues: PreflightIssue[],
): Readonly<Record<string, string>> {
  const environment = Object.create(null) as Record<string, string>;
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding.source === 'literal') {
      environment[name] = binding.value;
    } else if (binding.source === 'host') {
      const value = hostEnvironment[binding.name];
      if (
        !Object.hasOwn(hostEnvironment, binding.name) ||
        value === undefined
      ) {
        issues.push(
          blockIssue(
            blockIndex,
            blockId,
            `invocation.environment.${name}`,
            'adapter_host_environment_missing',
            'blocker',
            `Host environment variable "${binding.name}" is required but unavailable.`,
          ),
        );
      } else {
        environment[name] = value;
      }
    } else {
      const value = workflowValues?.get(binding.portId);
      if (value !== undefined) environment[name] = value;
    }
  }
  return environment;
}

function findShellOnlySyntaxField(
  block: WorkflowDefinition['blocks'][number],
): string | undefined {
  if (SHELL_ONLY_SYNTAX.test(block.invocation.executable)) {
    return 'invocation.executable';
  }
  const argumentIndex = block.invocation.arguments.findIndex(
    (argument) =>
      argument.type === 'literal' && SHELL_ONLY_SYNTAX.test(argument.value),
  );
  return argumentIndex === -1
    ? undefined
    : `invocation.arguments[${argumentIndex}]`;
}

function workflowInputToString(input: WorkflowRunInputValue): string {
  switch (input.kind) {
    case 'text':
      return input.value;
    case 'json':
      return JSON.stringify(input.value);
    case 'filesystem-reference':
      return input.path;
  }
}

function executableIssue(
  blockIndex: number,
  blockId: string,
  message: string,
): PreflightIssue {
  return blockIssue(
    blockIndex,
    blockId,
    'invocation.executable',
    'adapter_executable_not_found',
    'blocker',
    message,
  );
}

function blockIssue(
  blockIndex: number,
  blockId: string,
  field: string,
  code: `adapter_${string}`,
  severity: 'blocker' | 'warning',
  message: string,
): PreflightIssue {
  return {
    severity,
    code,
    message,
    path: `blocks[${blockIndex}].${field}`,
    blockId,
    field,
  };
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isDestructiveOutputPath(path: string): boolean {
  if (path === '/') return true;
  return [...DESTRUCTIVE_OUTPUT_LOCATIONS]
    .filter((location) => location !== '/')
    .some(
      (location) => path === location || path.startsWith(`${location}${sep}`),
    );
}
