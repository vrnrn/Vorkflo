import type {
  JsonValue,
  ProcessBlock,
  WorkflowDefinition,
} from '@vorkflo/engine';
import type { UserModelCatalog, UserToolModelCatalog } from './contracts.js';

export type AgentRuntimeId = 'codex' | 'cline' | 'antigravity';

export type AgentAuthority = 'read-only' | 'workspace-write';

export type AgentInstructionDeliveryMode =
  'argument' | 'template' | 'stdin' | 'file';

export interface AgentRuntimeCapabilities {
  readonly modelOverride: boolean;
  readonly instructionDeliveryModes: readonly AgentInstructionDeliveryMode[];
  readonly separateTextContext: boolean;
  readonly authorities: readonly AgentAuthority[];
  readonly declaredFilesystemOutputs: boolean;
  readonly images: boolean;
  readonly structuredEvents: boolean;
  readonly sessionResume: boolean;
}

export interface AgentRuntimeDescriptor {
  readonly id: AgentRuntimeId;
  readonly displayName: string;
  readonly executable: string;
  readonly guidance: string;
  readonly modelOverride: boolean;
  readonly instructionDeliveryModes: readonly AgentInstructionDeliveryMode[];
  readonly separateTextContext: boolean;
  readonly authorities: readonly AgentAuthority[];
  readonly declaredFilesystemOutputs: boolean;
  readonly capabilities: AgentRuntimeCapabilities;
  readonly installGuidance: string;
  readonly authenticationGuidance: string;
}

/**
 * Desktop-owned runtime catalog. A declared capability means this compiler can
 * represent it faithfully in a generic ProcessBlock; it is not inferred from
 * an executable name at run time.
 */
export const AGENT_RUNTIME_REGISTRY: readonly AgentRuntimeDescriptor[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    executable: 'codex',
    guidance: 'Runs one-shot Codex exec using the local Codex configuration.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: true,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: true,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: true,
      sessionResume: false,
    },
    installGuidance: 'Install the Codex CLI and ensure `codex` is on PATH.',
    authenticationGuidance: 'Authenticate with the Codex CLI before running.',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    executable: 'cline',
    guidance: 'Runs one-shot Cline CLI using Cline-owned authentication.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: false,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: false,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: false,
      sessionResume: false,
    },
    installGuidance: 'Install the Cline CLI and ensure `cline` is on PATH.',
    authenticationGuidance: 'Run `cline auth` before non-interactive use.',
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    executable: 'agy',
    guidance:
      'Runs Antigravity print mode using Antigravity-owned authentication.',
    modelOverride: true,
    instructionDeliveryModes: ['argument', 'template'],
    separateTextContext: false,
    authorities: ['read-only', 'workspace-write'],
    declaredFilesystemOutputs: true,
    capabilities: {
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      separateTextContext: false,
      authorities: ['read-only', 'workspace-write'],
      declaredFilesystemOutputs: true,
      images: false,
      structuredEvents: false,
      sessionResume: false,
    },
    installGuidance: 'Install Antigravity CLI and ensure `agy` is on PATH.',
    authenticationGuidance:
      'Sign in through Antigravity before non-interactive use.',
  },
];

export function getAgentRuntimeDescriptor(
  runtimeId: AgentRuntimeId,
): AgentRuntimeDescriptor {
  const descriptor = AGENT_RUNTIME_REGISTRY.find(
    (candidate) => candidate.id === runtimeId,
  );
  if (descriptor === undefined) {
    throw new Error(`Unknown Agent runtime: ${runtimeId}`);
  }
  return descriptor;
}

export interface AgentTextContextConfig {
  readonly portId: string;
  readonly name: string;
}

export interface AgentNamedContextConfig {
  readonly portId: string;
  readonly name: string;
  readonly artifactKind: 'text' | 'json';
  /** Placeholder name used by the visible deterministic instruction template. */
  readonly templateKey: string;
  readonly required?: boolean;
}

export interface AgentTextResponseConfig {
  readonly portId: string;
  readonly name: string;
}

export interface AgentFilesystemOutputConfig {
  readonly portId: string;
  readonly name: string;
  readonly path: string;
  readonly entity: 'file' | 'directory';
}

export type AgentIsolationConfig =
  | { readonly mode: 'current-directory' }
  | {
      readonly mode: 'workflow-run-worktree';
      readonly repositoryRoot: string;
      readonly baseRef: string;
      readonly scope: string;
    };

/**
 * Runtime-neutral editor state for a specialized AI Agent block.
 *
 * This state belongs to the desktop editor. The engine receives only the
 * generic ProcessBlock produced by compileAgentBlock.
 */
export interface AgentBlockEditorConfig {
  readonly id: string;
  readonly name: string;
  readonly agentRuntime: AgentRuntimeId;
  readonly instruction: string;
  readonly instructionDelivery?: AgentInstructionDeliveryMode;
  readonly instructionTemplate?: string;
  readonly model?: string;
  /** Codex-only, emitted as an exact model_reasoning_effort config override. */
  readonly reasoningEffort?: string;
  /** Codex-only. Defaults to true when omitted for legacy workflow compatibility. */
  readonly ephemeral?: boolean;
  /** Codex-only JSONL event stream on stdout. */
  readonly jsonl?: boolean;
  /** Codex-only path to a JSON Schema passed through --output-schema. */
  readonly outputSchemaPath?: string;
  /** Codex-only path receiving the final assistant message. */
  readonly outputLastMessagePath?: string;
  readonly isolation?: AgentIsolationConfig;
  /**
   * Canonical multi-input configuration. `textContext` remains readable for
   * v0.3 workflow reconstruction and is normalized into this shape at compile
   * time.
   */
  readonly contexts?: readonly AgentNamedContextConfig[];
  readonly textContext?: AgentTextContextConfig;
  readonly workingDirectory?: string;
  readonly authority: AgentAuthority;
  readonly textResponse: AgentTextResponseConfig;
  readonly filesystemOutputs: readonly AgentFilesystemOutputConfig[];
}

export interface AgentBlockPresentation {
  readonly kind: 'ai-agent';
  readonly agentRuntime: AgentRuntimeId;
  readonly isolation?: AgentIsolationConfig;
}

export interface AgentBlockMetadataIssue {
  readonly code: 'runtime-unsupported' | 'isolation-invalid';
  readonly field: 'editor.agentRuntime' | 'editor.isolation';
  readonly message: string;
}

export const CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE =
  '{{instruction}}\n\nConnected context:\n{{context}}';

const desktopEditorKey = 'vorkflo.desktop';

interface DesktopEditorMetadata {
  readonly schemaVersion: 1;
  readonly blockPresentations: Readonly<Record<string, JsonValue>>;
}

/** Compile a desktop AI Agent configuration into the generic engine contract. */
export function compileAgentBlock(
  config: AgentBlockEditorConfig,
): ProcessBlock {
  assertSupportedConfiguration(config);
  switch (config.agentRuntime) {
    case 'codex':
      return compileCodexAgentBlock(config);
    case 'cline':
      return compileClineAgentBlock(config);
    case 'antigravity':
      return compileAntigravityAgentBlock(config);
  }
}

export function getAgentBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
): AgentBlockPresentation | undefined {
  const metadata = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  return parseAgentBlockPresentation(metadata?.blockPresentations[blockId]);
}

export function getAgentBlockMetadataIssue(
  workflow: WorkflowDefinition,
  blockId: string,
): AgentBlockMetadataIssue | undefined {
  const value = workflow.editor?.[desktopEditorKey];
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  if (!isRecord(value.blockPresentations)) return undefined;
  const candidate = value.blockPresentations[blockId];
  if (!isRecord(candidate) || candidate.kind !== 'ai-agent') return undefined;
  if (!isAgentRuntimeId(candidate.agentRuntime)) {
    const runtime =
      typeof candidate.agentRuntime === 'string'
        ? candidate.agentRuntime
        : 'unknown';
    return {
      code: 'runtime-unsupported',
      field: 'editor.agentRuntime',
      message: `Agent runtime ${JSON.stringify(runtime)} is not supported by this Vorkflo installation. Choose Codex, Cline, or Antigravity before running.`,
    };
  }
  if (
    candidate.isolation !== undefined &&
    parseAgentIsolation(candidate.isolation) === undefined
  ) {
    return {
      code: 'isolation-invalid',
      field: 'editor.isolation',
      message:
        'The saved Agent worktree isolation metadata is invalid or unsupported. Review the repository root, base ref, and scope before running.',
    };
  }
  return undefined;
}

export function setAgentBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
  agentRuntime: AgentRuntimeId,
  isolation?: AgentIsolationConfig,
): WorkflowDefinition {
  const current = parseDesktopEditorMetadata(
    workflow.editor?.[desktopEditorKey],
  );
  const metadata: DesktopEditorMetadata = {
    schemaVersion: 1,
    blockPresentations: {
      ...(current?.blockPresentations ?? {}),
      [blockId]: {
        kind: 'ai-agent',
        agentRuntime,
        ...(isolation === undefined ? {} : { isolation }),
      } as unknown as JsonValue,
    },
  };
  return {
    ...workflow,
    editor: {
      ...(workflow.editor ?? {}),
      [desktopEditorKey]: metadata as unknown as JsonValue,
    },
  };
}

export function removeBlockPresentation(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  const current = workflow.editor?.[desktopEditorKey];
  if (
    !isRecord(current) ||
    current.schemaVersion !== 1 ||
    !isRecord(current.blockPresentations) ||
    current.blockPresentations[blockId] === undefined
  ) {
    return workflow;
  }
  const blockPresentations = { ...current.blockPresentations };
  delete blockPresentations[blockId];
  return {
    ...workflow,
    editor: {
      ...(workflow.editor ?? {}),
      [desktopEditorKey]: {
        schemaVersion: 1,
        blockPresentations,
      } as unknown as JsonValue,
    },
  };
}

/**
 * Reconstructs editable fields from the authoritative compiled process. The
 * metadata selects the editor/runtime only; it does not duplicate instructions,
 * paths, authority, or outputs.
 */
export function agentEditorConfigFromBlock(
  block: ProcessBlock,
  presentation: AgentBlockPresentation,
): AgentBlockEditorConfig {
  const arguments_ = literalArgumentValues(block);
  const templateArgument = block.invocation.arguments.find(
    (argument) => argument.type === 'template',
  );
  const authority = authorityFromArguments(
    presentation.agentRuntime,
    arguments_,
  );
  const model = optionValue(arguments_, '--model');
  const reasoningEffort = codexConfigValue(
    arguments_,
    'model_reasoning_effort',
  );
  const textBinding = block.invocation.outputs.find(
    (output) => output.type === 'stdout',
  );
  const textPort = block.outputs.find(
    (output) => output.id === textBinding?.portId,
  );
  const contextPortId =
    block.invocation.stdin !== undefined && 'portId' in block.invocation.stdin
      ? block.invocation.stdin.portId
      : templateArgument?.inputs.context !== undefined &&
          'portId' in templateArgument.inputs.context
        ? templateArgument.inputs.context.portId
        : undefined;
  const stdinPort = block.inputs.find((input) => input.id === contextPortId);
  const templateContexts = Object.entries(templateArgument?.inputs ?? {})
    .filter(([key, binding]) => key !== 'instruction' && 'portId' in binding)
    .flatMap(([templateKey, binding]) => {
      if (!('portId' in binding)) return [];
      const port = block.inputs.find((input) => input.id === binding.portId);
      if (port === undefined || port.artifactKind === 'filesystem-reference') {
        return [];
      }
      return [
        {
          portId: port.id,
          name: port.name,
          artifactKind: port.artifactKind,
          templateKey,
          required: port.required,
        } satisfies AgentNamedContextConfig,
      ];
    });
  const templateInstruction = templateArgument?.inputs.instruction;
  const migrateClineStdinContext =
    presentation.agentRuntime === 'cline' &&
    templateArgument === undefined &&
    stdinPort !== undefined;

  return {
    id: block.id,
    name: block.name,
    agentRuntime: presentation.agentRuntime,
    instruction:
      templateInstruction !== undefined && 'value' in templateInstruction
        ? templateInstruction.value
        : instructionFromArguments(presentation.agentRuntime, arguments_),
    ...(templateArgument === undefined
      ? migrateClineStdinContext
        ? {
            instructionDelivery: 'template' as const,
            instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
          }
        : {}
      : {
          instructionDelivery: 'template',
          instructionTemplate: templateArgument.template,
        }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(presentation.agentRuntime !== 'codex' ||
    arguments_.includes('--ephemeral')
      ? {}
      : { ephemeral: false }),
    ...(presentation.agentRuntime === 'codex' && arguments_.includes('--json')
      ? { jsonl: true }
      : {}),
    ...(presentation.agentRuntime === 'codex' &&
    optionValue(arguments_, '--output-schema') !== undefined
      ? { outputSchemaPath: optionValue(arguments_, '--output-schema')! }
      : {}),
    ...(presentation.agentRuntime === 'codex' &&
    optionValue(arguments_, '--output-last-message') !== undefined
      ? {
          outputLastMessagePath: optionValue(
            arguments_,
            '--output-last-message',
          )!,
        }
      : {}),
    ...(presentation.isolation === undefined
      ? {}
      : { isolation: presentation.isolation }),
    ...(templateContexts.length === 1 &&
    templateContexts[0]?.templateKey === 'context' &&
    templateContexts[0]?.artifactKind === 'text'
      ? {
          textContext: {
            portId: templateContexts[0].portId,
            name: templateContexts[0].name,
          },
        }
      : templateContexts.length > 0
        ? { contexts: templateContexts }
        : stdinPort === undefined
          ? {}
          : stdinPort.artifactKind === 'text'
            ? { textContext: { portId: stdinPort.id, name: stdinPort.name } }
            : {
                contexts: [
                  {
                    portId: stdinPort.id,
                    name: stdinPort.name,
                    artifactKind: 'json' as const,
                    templateKey: 'context',
                    required: stdinPort.required,
                  },
                ],
              }),
    ...(block.invocation.workingDirectory === undefined
      ? {}
      : { workingDirectory: block.invocation.workingDirectory }),
    authority,
    textResponse: {
      portId: textPort?.id ?? 'response',
      name: textPort?.name ?? 'Response',
    },
    filesystemOutputs: block.invocation.outputs.flatMap((binding) => {
      if (binding.type !== 'filesystem') return [];
      const port = block.outputs.find((output) => output.id === binding.portId);
      return [
        {
          portId: binding.portId,
          name: port?.name ?? binding.portId,
          path: binding.path,
          entity:
            binding.entity === 'directory' ? 'directory' : ('file' as const),
        },
      ];
    }),
  };
}

/**
 * Cline 3.0.39 consumes piped context only in JSON event mode. Vorkflo's
 * direct text-output integration therefore places connected context in the
 * visible positional instruction template. This upgrades v0.3 blocks compiled
 * before that CLI behavior was verified.
 */
export function normalizeAgentRuntimeWorkflow(workflow: WorkflowDefinition): {
  readonly workflow: WorkflowDefinition;
  readonly migratedBlockIds: readonly string[];
} {
  const migratedBlockIds: string[] = [];
  const blocks = workflow.blocks.map((block) => {
    const presentation = getAgentBlockPresentation(workflow, block.id);
    if (
      presentation?.agentRuntime !== 'cline' ||
      block.invocation.stdin === undefined ||
      !('portId' in block.invocation.stdin) ||
      block.invocation.arguments.some(
        (argument) => argument.type === 'template',
      )
    ) {
      return block;
    }
    const config = agentEditorConfigFromBlock(block, presentation);
    if (config.textContext === undefined) return block;
    migratedBlockIds.push(block.id);
    return compileAgentBlock({
      ...config,
      instructionDelivery: 'template',
      instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
    });
  });
  return migratedBlockIds.length === 0
    ? { workflow, migratedBlockIds }
    : { workflow: { ...workflow, blocks }, migratedBlockIds };
}

export function modelsForAgentRuntime(
  catalog: UserModelCatalog,
  runtime: AgentRuntimeId,
): UserToolModelCatalog {
  switch (runtime) {
    case 'codex':
      return catalog.codex;
    case 'cline':
      return catalog.cline;
    case 'antigravity':
      return catalog.agy;
  }
}

/** Apply machine-local defaults only when a block has no explicit model. */
export function applyUserModelDefaults(
  workflow: WorkflowDefinition,
  catalog: UserModelCatalog,
): WorkflowDefinition {
  let changed = false;
  const blocks = workflow.blocks.map((block) => {
    const presentation = getAgentBlockPresentation(workflow, block.id);
    if (presentation === undefined) return block;
    const config = agentEditorConfigFromBlock(block, presentation);
    const configuredDefault = modelsForAgentRuntime(
      catalog,
      presentation.agentRuntime,
    ).default;
    if (config.model !== undefined || configuredDefault === undefined) {
      return block;
    }
    changed = true;
    return compileAgentBlock({ ...config, model: configuredDefault });
  });
  return changed ? { ...workflow, blocks } : workflow;
}

export function alignAgentRuntimeWorkingDirectories(
  workflow: WorkflowDefinition,
): WorkflowDefinition {
  let changed = false;
  const blocks = workflow.blocks.map((block) => {
    const workingDirectory = block.invocation.workingDirectory;
    const presentation = getAgentBlockPresentation(workflow, block.id);
    if (
      presentation?.agentRuntime !== 'antigravity' ||
      workingDirectory === undefined
    ) {
      return block;
    }
    changed = true;
    return withResolvedAgentWorkingDirectory(
      block,
      presentation,
      workingDirectory,
    );
  });
  return changed ? { ...workflow, blocks } : workflow;
}

export function withResolvedAgentWorkingDirectory(
  block: ProcessBlock,
  presentation: AgentBlockPresentation | undefined,
  workingDirectory: string,
): ProcessBlock {
  if (presentation?.agentRuntime !== 'antigravity') return block;
  const argumentsWithoutWorkspace: ProcessBlock['invocation']['arguments'] = [];
  for (let index = 0; index < block.invocation.arguments.length; index += 1) {
    const argument = block.invocation.arguments[index]!;
    if (argument.type === 'literal' && argument.value === '--add-dir') {
      index += 1;
      continue;
    }
    argumentsWithoutWorkspace.push(argument);
  }
  return {
    ...block,
    invocation: {
      ...block.invocation,
      workingDirectory,
      arguments: [
        literal('--add-dir'),
        literal(workingDirectory),
        ...argumentsWithoutWorkspace,
      ],
    },
  };
}

function assertSupportedConfiguration(config: AgentBlockEditorConfig): void {
  const descriptor = getAgentRuntimeDescriptor(config.agentRuntime);
  const delivery = config.instructionDelivery ?? 'argument';
  if (config.contexts !== undefined && config.textContext !== undefined) {
    throw new Error(
      'Use either named Agent contexts or the legacy text context, not both.',
    );
  }
  const contexts = namedContexts(config);
  if (!descriptor.capabilities.instructionDeliveryModes.includes(delivery)) {
    throw new Error(
      `${descriptor.displayName} does not support ${delivery} instruction delivery. Choose ${descriptor.capabilities.instructionDeliveryModes.join(' or ')}.`,
    );
  }
  if (config.model !== undefined && !descriptor.capabilities.modelOverride) {
    throw new Error(
      `${descriptor.displayName} does not support model overrides.`,
    );
  }
  if (!descriptor.capabilities.authorities.includes(config.authority)) {
    throw new Error(
      `${descriptor.displayName} does not support ${config.authority} authority.`,
    );
  }
  if (
    contexts.length > 0 &&
    !descriptor.capabilities.separateTextContext &&
    delivery !== 'template'
  ) {
    throw new Error(
      `${descriptor.displayName} cannot receive separate connected text context in one-shot mode.`,
    );
  }
  if (contexts.length > 1 && delivery !== 'template') {
    throw new Error(
      'Multiple named contexts require visible deterministic template instruction delivery.',
    );
  }
  const portIds = contexts.map((context) => context.portId);
  const templateKeys = contexts.map((context) => context.templateKey);
  if (new Set(portIds).size !== portIds.length) {
    throw new Error('Connected Agent context port IDs must be unique.');
  }
  if (new Set(templateKeys).size !== templateKeys.length) {
    throw new Error('Connected Agent context template keys must be unique.');
  }
  if (
    contexts.some(
      (context) => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(context.templateKey),
    )
  ) {
    throw new Error(
      'Connected Agent context template keys must be portable identifiers.',
    );
  }
  if (
    config.agentRuntime !== 'codex' &&
    (config.reasoningEffort !== undefined ||
      config.ephemeral !== undefined ||
      config.jsonl !== undefined ||
      config.outputSchemaPath !== undefined ||
      config.outputLastMessagePath !== undefined)
  ) {
    throw new Error(
      'Codex execution options can only be used by Codex Agents.',
    );
  }
  if (
    config.reasoningEffort !== undefined &&
    config.reasoningEffort.trim() === ''
  ) {
    throw new Error('Codex reasoning effort cannot be empty.');
  }
  if (
    config.outputSchemaPath !== undefined &&
    config.outputSchemaPath.trim() === ''
  ) {
    throw new Error('Codex output schema path cannot be empty.');
  }
  if (
    config.outputLastMessagePath !== undefined &&
    config.outputLastMessagePath.trim() === ''
  ) {
    throw new Error('Codex final-message output path cannot be empty.');
  }
  if (delivery === 'template') {
    if (config.instructionTemplate === undefined) {
      throw new Error(
        'Template instruction delivery requires a visible instruction template.',
      );
    }
    const template = config.instructionTemplate;
    if (!template.includes('{{instruction}}')) {
      throw new Error('Instruction templates must include {{instruction}}.');
    }
    for (const context of contexts) {
      if (!template.includes(`{{${context.templateKey}}}`)) {
        throw new Error(
          `Instruction templates with connected context must include {{${context.templateKey}}}.`,
        );
      }
    }
  }
}

function compileCodexAgentBlock(config: AgentBlockEditorConfig): ProcessBlock {
  const contexts = namedContexts(config);
  const delivery = config.instructionDelivery ?? 'argument';

  return {
    id: config.id,
    name: config.name,
    kind: 'process',
    inputs: contexts.map(contextInputPort),
    outputs: [
      {
        id: config.textResponse.portId,
        name: config.textResponse.name,
        artifactKind: 'text',
      },
      ...config.filesystemOutputs.map((output) => ({
        id: output.portId,
        name: output.name,
        artifactKind: 'filesystem-reference' as const,
      })),
    ],
    invocation: {
      executable: 'codex',
      arguments: codexArguments(config),
      ...(config.workingDirectory === undefined
        ? {}
        : { workingDirectory: config.workingDirectory }),
      environment: {
        HOME: { source: 'host', name: 'HOME' },
        PATH: { source: 'host', name: 'PATH' },
      },
      ...(contexts.length !== 1 || delivery === 'template'
        ? {}
        : { stdin: { portId: contexts[0]!.portId } }),
      shell: false,
      outputs: [
        { type: 'stdout', portId: config.textResponse.portId },
        ...config.filesystemOutputs.map((output) => ({
          type: 'filesystem' as const,
          portId: output.portId,
          path: output.path,
          entity: output.entity,
        })),
      ],
    },
  };
}

function codexArguments(
  config: AgentBlockEditorConfig,
): ProcessBlock['invocation']['arguments'] {
  return [
    literal('exec'),
    ...((config.ephemeral ?? true) ? [literal('--ephemeral')] : []),
    literal('--skip-git-repo-check'),
    literal('--sandbox'),
    literal(config.authority),
    literal('--color'),
    literal('never'),
    ...(config.model === undefined
      ? []
      : [literal('--model'), literal(config.model)]),
    ...(config.reasoningEffort === undefined
      ? []
      : [
          literal('--config'),
          literal(
            `model_reasoning_effort=${JSON.stringify(config.reasoningEffort)}`,
          ),
        ]),
    ...(config.outputSchemaPath === undefined
      ? []
      : [literal('--output-schema'), literal(config.outputSchemaPath)]),
    ...(config.jsonl === true ? [literal('--json')] : []),
    ...(config.outputLastMessagePath === undefined
      ? []
      : [
          literal('--output-last-message'),
          literal(config.outputLastMessagePath),
        ]),
    agentInstructionArgument(config),
  ];
}

function compileClineAgentBlock(config: AgentBlockEditorConfig): ProcessBlock {
  return compileDirectAgentBlock(config, {
    executable: 'cline',
    arguments: [
      ...(config.authority === 'read-only' ? [literal('--plan')] : []),
      ...(config.model === undefined
        ? []
        : [literal('--model'), literal(config.model)]),
      agentInstructionArgument(config),
    ],
  });
}

function compileAntigravityAgentBlock(
  config: AgentBlockEditorConfig,
): ProcessBlock {
  const block = compileDirectAgentBlock(config, {
    executable: 'agy',
    arguments: [
      ...(config.authority === 'read-only' ? [literal('--sandbox')] : []),
      ...(config.model === undefined
        ? []
        : [literal('--model'), literal(config.model)]),
      literal('--print'),
      agentInstructionArgument(config),
    ],
  });
  return config.workingDirectory === undefined
    ? block
    : withResolvedAgentWorkingDirectory(
        block,
        { kind: 'ai-agent', agentRuntime: 'antigravity' },
        config.workingDirectory,
      );
}

function compileDirectAgentBlock(
  config: AgentBlockEditorConfig,
  invocation: Pick<ProcessBlock['invocation'], 'executable' | 'arguments'>,
): ProcessBlock {
  const contexts = namedContexts(config);
  const delivery = config.instructionDelivery ?? 'argument';
  return {
    id: config.id,
    name: config.name,
    kind: 'process',
    inputs: contexts.map(contextInputPort),
    outputs: [
      {
        id: config.textResponse.portId,
        name: config.textResponse.name,
        artifactKind: 'text',
      },
      ...config.filesystemOutputs.map((output) => ({
        id: output.portId,
        name: output.name,
        artifactKind: 'filesystem-reference' as const,
      })),
    ],
    invocation: {
      ...invocation,
      ...(config.workingDirectory === undefined
        ? {}
        : { workingDirectory: config.workingDirectory }),
      environment: {
        HOME: { source: 'host', name: 'HOME' },
        PATH: { source: 'host', name: 'PATH' },
      },
      ...(contexts.length !== 1 || delivery === 'template'
        ? {}
        : { stdin: { portId: contexts[0]!.portId } }),
      shell: false,
      outputs: [
        { type: 'stdout', portId: config.textResponse.portId },
        ...config.filesystemOutputs.map((output) => ({
          type: 'filesystem' as const,
          portId: output.portId,
          path: output.path,
          entity: output.entity,
        })),
      ],
    },
  };
}

function literalArgumentValues(block: ProcessBlock): string[] {
  return block.invocation.arguments.flatMap((argument) =>
    argument.type === 'literal' ? [argument.value] : [],
  );
}

function optionValue(
  arguments_: readonly string[],
  option: string,
): string | undefined {
  const index = arguments_.indexOf(option);
  return index < 0 ? undefined : arguments_[index + 1];
}

function codexConfigValue(
  arguments_: readonly string[],
  key: string,
): string | undefined {
  for (let index = 0; index < arguments_.length - 1; index += 1) {
    if (arguments_[index] !== '--config' && arguments_[index] !== '-c')
      continue;
    const candidate = arguments_[index + 1]!;
    if (!candidate.startsWith(`${key}=`)) continue;
    const value = candidate.slice(key.length + 1);
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value;
    } catch {
      return value;
    }
  }
  return undefined;
}

function instructionFromArguments(
  runtime: AgentRuntimeId,
  arguments_: readonly string[],
): string {
  switch (runtime) {
    case 'codex':
    case 'cline':
    case 'antigravity':
      return arguments_.at(-1) ?? '';
  }
}

function authorityFromArguments(
  runtime: AgentRuntimeId,
  arguments_: readonly string[],
): AgentAuthority {
  switch (runtime) {
    case 'codex':
      return optionValue(arguments_, '--sandbox') === 'workspace-write'
        ? 'workspace-write'
        : 'read-only';
    case 'cline':
      return arguments_.includes('--plan') ? 'read-only' : 'workspace-write';
    case 'antigravity':
      return arguments_.includes('--sandbox') ? 'read-only' : 'workspace-write';
  }
}

function literal(value: string) {
  return { type: 'literal' as const, value };
}

function agentInstructionArgument(
  config: AgentBlockEditorConfig,
): ProcessBlock['invocation']['arguments'][number] {
  if ((config.instructionDelivery ?? 'argument') !== 'template') {
    return literal(config.instruction);
  }
  return {
    type: 'template',
    template: config.instructionTemplate!,
    inputs: {
      instruction: { value: config.instruction },
      ...Object.fromEntries(
        namedContexts(config).map((context) => [
          context.templateKey,
          { portId: context.portId },
        ]),
      ),
    },
  };
}

function namedContexts(
  config: AgentBlockEditorConfig,
): readonly AgentNamedContextConfig[] {
  if (config.contexts !== undefined) return config.contexts;
  return config.textContext === undefined
    ? []
    : [
        {
          ...config.textContext,
          artifactKind: 'text',
          templateKey: 'context',
          required: false,
        },
      ];
}

function contextInputPort(context: AgentNamedContextConfig) {
  return {
    id: context.portId,
    name: context.name,
    artifactKind: context.artifactKind,
    required: context.required ?? false,
  };
}

function parseDesktopEditorMetadata(
  value: JsonValue | undefined,
): DesktopEditorMetadata | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  if (!isRecord(value.blockPresentations)) return undefined;
  const blockPresentations: Record<string, JsonValue> = {
    ...value.blockPresentations,
  };
  return { schemaVersion: 1, blockPresentations };
}

function parseAgentBlockPresentation(
  candidate: JsonValue | undefined,
): AgentBlockPresentation | undefined {
  if (
    !isRecord(candidate) ||
    candidate.kind !== 'ai-agent' ||
    !isAgentRuntimeId(candidate.agentRuntime)
  ) {
    return undefined;
  }
  const isolation = parseAgentIsolation(candidate.isolation);
  return {
    kind: 'ai-agent',
    agentRuntime: candidate.agentRuntime,
    ...(isolation === undefined ? {} : { isolation }),
  };
}

function parseAgentIsolation(
  value: JsonValue | undefined,
): AgentIsolationConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (value.mode === 'current-directory') {
    return { mode: 'current-directory' };
  }
  if (
    value.mode === 'workflow-run-worktree' &&
    typeof value.repositoryRoot === 'string' &&
    typeof value.baseRef === 'string' &&
    typeof value.scope === 'string'
  ) {
    return {
      mode: 'workflow-run-worktree',
      repositoryRoot: value.repositoryRoot,
      baseRef: value.baseRef,
      scope: value.scope,
    };
  }
  return undefined;
}

function isAgentRuntimeId(
  value: JsonValue | undefined,
): value is AgentRuntimeId {
  return value === 'codex' || value === 'cline' || value === 'antigravity';
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
