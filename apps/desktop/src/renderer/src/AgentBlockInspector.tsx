import type { ProcessBlock } from '@vorkflo/engine';
import {
  Bot,
  FileOutput,
  FolderOpen,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  AGENT_RUNTIME_REGISTRY,
  CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
  agentEditorConfigFromBlock,
  compileAgentBlock,
  getAgentRuntimeDescriptor,
  modelsForAgentRuntime,
  type AgentBlockEditorConfig,
  type AgentBlockPresentation,
  type AgentFilesystemOutputConfig,
  type AgentIsolationConfig,
  type AgentInstructionDeliveryMode,
  type AgentNamedContextConfig,
  type AgentRuntimeId,
} from '../../shared/agent-runtime';
import type { UserModelCatalog } from '../../shared/contracts';
import { InvocationPreview } from './InvocationPreview';

type PathSelector = (
  kind: 'file' | 'directory' | 'output-file',
  defaultPath?: string,
) => Promise<string | undefined>;

type MutableAgentBlockEditorConfig = {
  -readonly [Key in keyof AgentBlockEditorConfig]: AgentBlockEditorConfig[Key];
};

type WorktreeIsolationConfig = Extract<
  AgentIsolationConfig,
  { readonly mode: 'workflow-run-worktree' }
>;

export function AgentBlockInspector({
  block,
  presentation,
  onChange,
  selectPath,
  modelCatalog,
  modelCatalogPath,
}: {
  block: ProcessBlock;
  presentation: AgentBlockPresentation;
  onChange: (block: ProcessBlock, presentation: AgentBlockPresentation) => void;
  selectPath: PathSelector;
  modelCatalog?: UserModelCatalog;
  modelCatalogPath?: string;
}) {
  const reconstructed = agentEditorConfigFromBlock(block, presentation);
  const configuredModels =
    modelCatalog === undefined
      ? { models: [] as readonly string[] }
      : modelsForAgentRuntime(modelCatalog, reconstructed.agentRuntime);
  const config: AgentBlockEditorConfig =
    reconstructed.model === undefined && configuredModels.default !== undefined
      ? { ...reconstructed, model: configuredModels.default }
      : reconstructed;
  const contexts = configuredContexts(config);
  const runtime = getAgentRuntimeDescriptor(config.agentRuntime);
  const commit = (next: AgentBlockEditorConfig): void =>
    onChange(compileAgentBlock(next), presentationFromConfig(next));
  const update = (patch: Partial<AgentBlockEditorConfig>): void =>
    commit({ ...config, ...patch });

  const removeSetting = <Key extends keyof AgentBlockEditorConfig>(
    key: Key,
  ): void => {
    const next = { ...config };
    delete next[key];
    commit(next);
  };

  const selectRuntime = (agentRuntime: AgentRuntimeId): void => {
    const nextRuntime = getAgentRuntimeDescriptor(agentRuntime);
    const next: MutableAgentBlockEditorConfig = { ...config, agentRuntime };
    const nextModels =
      modelCatalog === undefined
        ? undefined
        : modelsForAgentRuntime(modelCatalog, agentRuntime);
    if (nextModels?.default === undefined) delete next.model;
    else next.model = nextModels.default;
    if (
      !nextRuntime.capabilities.separateTextContext &&
      configuredContexts(next).length > 0 &&
      (next.instructionDelivery ?? 'argument') !== 'template'
    ) {
      next.instructionDelivery = 'template';
      next.instructionTemplate = CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE;
    }
    if (!nextRuntime.capabilities.modelOverride) {
      delete next.model;
    }
    if (agentRuntime !== 'codex') {
      delete next.reasoningEffort;
      delete next.ephemeral;
      delete next.jsonl;
      delete next.outputSchemaPath;
      delete next.outputLastMessagePath;
    }
    if (
      !nextRuntime.capabilities.instructionDeliveryModes.includes(
        next.instructionDelivery ?? 'argument',
      )
    ) {
      next.instructionDelivery =
        nextRuntime.capabilities.instructionDeliveryModes[0] ?? 'argument';
    }
    commit(next);
  };

  const setContexts = (
    nextContexts: readonly AgentNamedContextConfig[],
  ): void => {
    const { textContext: _legacyTextContext, ...withoutLegacyContext } = config;
    commit({ ...withoutLegacyContext, contexts: nextContexts });
  };

  return (
    <div className="inspector-scroll agent-inspector">
      <section className="inspector-section">
        <header>
          <span>Agent</span>
        </header>
        <label className="field">
          <span>Display name</span>
          <input
            data-inspector-field="identity.name"
            value={config.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Agent runtime</span>
          <select
            data-inspector-field="editor.agentRuntime"
            aria-label="Agent runtime"
            value={config.agentRuntime}
            onChange={(event) =>
              selectRuntime(event.target.value as AgentRuntimeId)
            }
          >
            {AGENT_RUNTIME_REGISTRY.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          <small>
            {runtime.installGuidance} {runtime.authenticationGuidance}
          </small>
        </label>
        {runtime.capabilities.modelOverride && (
          <>
            <label className="field">
              <span>Model</span>
              <select
                data-inspector-field="editor.model"
                aria-label="Agent model"
                value={modelSelection(config.model, configuredModels.models)}
                onChange={(event) => {
                  if (event.target.value === 'runtime-default') {
                    removeSetting('model');
                    return;
                  }
                  if (event.target.value.startsWith('configured:')) {
                    const index = Number(
                      event.target.value.slice('configured:'.length),
                    );
                    const model = configuredModels.models[index];
                    if (model !== undefined) update({ model });
                    return;
                  }
                  update({ model: '' });
                }}
              >
                {configuredModels.default === undefined && (
                  <option value="runtime-default">Use runtime default</option>
                )}
                {configuredModels.models.map((model, index) => (
                  <option key={model} value={`configured:${index}`}>
                    {model}
                    {model === configuredModels.default ? ' (default)' : ''}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <small>
                {modelCatalogPath === undefined
                  ? 'Loading the user model catalog…'
                  : `Configured in ${modelCatalogPath}`}
              </small>
            </label>
            {modelSelection(config.model, configuredModels.models) ===
              'custom' && (
              <label className="field">
                <span>Model identifier</span>
                <input
                  data-inspector-field="editor.model"
                  aria-label="Agent model override"
                  value={config.model}
                  placeholder="Exact runtime model identifier"
                  onChange={(event) => update({ model: event.target.value })}
                />
                <small>
                  Passed exactly to {runtime.displayName}; credentials and the
                  model remain runtime-owned.
                </small>
              </label>
            )}
          </>
        )}
        {config.agentRuntime === 'codex' && (
          <>
            {(modelCatalog?.codex.intelligenceProfiles?.length ?? 0) > 0 && (
              <label className="field">
                <span>Intelligence profile</span>
                <select
                  aria-label="Codex intelligence profile"
                  value={intelligenceProfileSelection(
                    config,
                    modelCatalog?.codex.intelligenceProfiles ?? [],
                  )}
                  onChange={(event) => {
                    if (event.target.value === 'custom') return;
                    const profile =
                      modelCatalog?.codex.intelligenceProfiles?.[
                        Number(event.target.value)
                      ];
                    if (profile !== undefined) {
                      update({
                        model: profile.model,
                        reasoningEffort: profile.reasoningEffort,
                      });
                    }
                  }}
                >
                  <option value="custom">Custom exact settings</option>
                  {modelCatalog?.codex.intelligenceProfiles?.map(
                    (profile, index) => (
                      <option key={profile.name} value={index}>
                        {profile.name}
                      </option>
                    ),
                  )}
                </select>
                <small>
                  User-owned labels resolve to the exact model and reasoning
                  arguments shown below; no provider model is hidden in the
                  workflow.
                </small>
              </label>
            )}
            <label className="field">
              <span>Reasoning effort</span>
              <input
                aria-label="Codex reasoning effort"
                value={config.reasoningEffort ?? ''}
                placeholder="Use Codex configuration default"
                onChange={(event) => {
                  if (event.target.value === '') {
                    removeSetting('reasoningEffort');
                  } else {
                    update({ reasoningEffort: event.target.value });
                  }
                }}
              />
              <small>Passed visibly as model_reasoning_effort.</small>
            </label>
            <label className="agent-context-toggle">
              <input
                type="checkbox"
                aria-label="Ephemeral Codex session"
                checked={config.ephemeral ?? true}
                onChange={(event) =>
                  update({ ephemeral: event.target.checked })
                }
              />
              Do not persist the Codex session
            </label>
            <label className="agent-context-toggle">
              <input
                type="checkbox"
                aria-label="Codex JSONL events"
                checked={config.jsonl ?? false}
                onChange={(event) => update({ jsonl: event.target.checked })}
              />
              Emit JSONL runtime events on stdout
            </label>
            <label className="field">
              <span>Output schema path</span>
              <input
                aria-label="Codex output schema path"
                value={config.outputSchemaPath ?? ''}
                placeholder="Optional JSON Schema file"
                onChange={(event) =>
                  updateOptionalString(
                    config,
                    commit,
                    'outputSchemaPath',
                    event.target.value,
                  )
                }
              />
            </label>
            <label className="field">
              <span>Final message output path</span>
              <input
                aria-label="Codex final message output path"
                value={config.outputLastMessagePath ?? ''}
                placeholder="Optional generated response file"
                onChange={(event) =>
                  updateOptionalString(
                    config,
                    commit,
                    'outputLastMessagePath',
                    event.target.value,
                  )
                }
              />
            </label>
          </>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Instruction</span>
        </header>
        <label className="field">
          <span>Delivery</span>
          <select
            data-inspector-field="editor.instructionDelivery"
            aria-label="Instruction delivery"
            value={config.instructionDelivery ?? 'argument'}
            onChange={(event) => {
              const instructionDelivery = event.target
                .value as AgentInstructionDeliveryMode;
              if (instructionDelivery === 'template') {
                update({
                  instructionDelivery,
                  instructionTemplate: defaultInstructionTemplate(contexts),
                });
                return;
              }
              const {
                instructionTemplate: _instructionTemplate,
                ...withoutTemplate
              } = config;
              commit({ ...withoutTemplate, instructionDelivery });
            }}
          >
            {runtime.capabilities.instructionDeliveryModes.map((mode) => (
              <option
                key={mode}
                value={mode}
                disabled={
                  mode !== 'template' &&
                  (contexts.length > 1 ||
                    (contexts.length > 0 &&
                      !runtime.capabilities.separateTextContext))
                }
              >
                {instructionDeliveryLabel(mode)}
              </option>
            ))}
          </select>
          <small>
            Only delivery modes implemented deterministically by this runtime
            are available.
          </small>
        </label>
        <label className="field">
          <span>
            {instructionDeliveryLabel(config.instructionDelivery ?? 'argument')}
          </span>
          <textarea
            data-inspector-field="invocation.arguments"
            aria-label="Agent instruction"
            rows={7}
            value={config.instruction}
            onChange={(event) => update({ instruction: event.target.value })}
          />
          <small>
            Vorkflo passes this text exactly through the selected delivery mode
            and does not append hidden instructions. The runtime may still load
            its own local configuration and project guidance.
          </small>
        </label>
        {(config.instructionDelivery ?? 'argument') === 'template' && (
          <label className="field">
            <span>Deterministic template</span>
            <textarea
              data-inspector-field="editor.instructionTemplate"
              aria-label="Agent instruction template"
              rows={5}
              value={
                config.instructionTemplate ??
                defaultInstructionTemplate(contexts)
              }
              onChange={(event) =>
                update({ instructionTemplate: event.target.value })
              }
            />
            <small>
              Use {'{{instruction}}'} for the exact instruction and each named
              input placeholder shown below. The generic engine resolves this
              visible template without hidden additions.
            </small>
          </label>
        )}
        {(runtime.capabilities.separateTextContext ||
          (config.instructionDelivery ?? 'argument') === 'template') && (
          <>
            <header>
              <span>Named inputs</span>
              <button
                className="section-action"
                aria-label="Add Agent context input"
                onClick={() => {
                  const nextContexts = [
                    ...contexts,
                    newNamedContext(block, contexts),
                  ];
                  const { textContext: _legacy, ...withoutLegacy } = config;
                  commit({
                    ...withoutLegacy,
                    contexts: nextContexts,
                    ...(nextContexts.length > 1 ||
                    !runtime.capabilities.separateTextContext
                      ? {
                          instructionDelivery: 'template',
                          instructionTemplate:
                            defaultInstructionTemplate(nextContexts),
                        }
                      : {}),
                  });
                }}
              >
                <Plus size={13} /> Add
              </button>
            </header>
            {contexts.map((context, index) => (
              <div
                className="agent-output-row agent-context-row"
                key={context.portId}
              >
                <input
                  aria-label={
                    contexts.length === 1
                      ? 'Agent context input name'
                      : `Agent context ${index + 1} name`
                  }
                  value={context.name}
                  onChange={(event) =>
                    setContexts(
                      replaceContext(contexts, index, {
                        name: event.target.value,
                      }),
                    )
                  }
                />
                <select
                  aria-label={`Agent context ${index + 1} artifact kind`}
                  value={context.artifactKind}
                  onChange={(event) =>
                    setContexts(
                      replaceContext(contexts, index, {
                        artifactKind: event.target.value as 'text' | 'json',
                      }),
                    )
                  }
                >
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                </select>
                <input
                  aria-label={`Agent context ${index + 1} template key`}
                  value={context.templateKey}
                  onChange={(event) => {
                    const nextContexts = replaceContext(contexts, index, {
                      templateKey: event.target.value,
                    });
                    const currentTemplate =
                      config.instructionTemplate ??
                      defaultInstructionTemplate(contexts);
                    const nextTemplate = currentTemplate.replaceAll(
                      `{{${context.templateKey}}}`,
                      `{{${event.target.value}}}`,
                    );
                    const { textContext: _legacy, ...withoutLegacy } = config;
                    commit({
                      ...withoutLegacy,
                      contexts: nextContexts,
                      instructionTemplate: nextTemplate,
                    });
                  }}
                />
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Agent context ${index + 1} required`}
                    checked={context.required ?? false}
                    onChange={(event) =>
                      setContexts(
                        replaceContext(contexts, index, {
                          required: event.target.checked,
                        }),
                      )
                    }
                  />
                  Required
                </label>
                <button
                  className="icon-button"
                  aria-label={`Remove Agent context ${context.name}`}
                  onClick={() => {
                    const nextContexts = contexts.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    );
                    const { textContext: _legacy, ...withoutLegacy } = config;
                    commit({
                      ...withoutLegacy,
                      contexts: nextContexts,
                      ...((config.instructionDelivery ?? 'argument') ===
                      'template'
                        ? {
                            instructionTemplate:
                              defaultInstructionTemplate(nextContexts),
                          }
                        : {}),
                    });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {contexts.length === 0 && (
              <div className="empty-line">No connected inputs declared</div>
            )}
          </>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Workspace authority</span>
        </header>
        <label className="field">
          <span>Sandbox</span>
          <select
            data-inspector-field="invocation.arguments"
            aria-label="Agent authority"
            value={config.authority}
            onChange={(event) =>
              update({
                authority: event.target
                  .value as AgentBlockEditorConfig['authority'],
              })
            }
          >
            {runtime.capabilities.authorities.map((authority) => (
              <option key={authority} value={authority}>
                {authorityLabel(config.agentRuntime, authority)}
              </option>
            ))}
          </select>
          {config.agentRuntime === 'cline' &&
            config.authority === 'read-only' && (
              <small>
                Cline plan mode is visible behavioral intent, not a hard
                filesystem sandbox. Use worktree isolation when repository
                boundaries matter.
              </small>
            )}
        </label>
        {config.authority === 'workspace-write' && (
          <div className="agent-authority-warning">
            <ShieldAlert size={14} />
            <span>
              {runtime.displayName} may create or modify files inside the
              resolved working directory. Generated paths must still be declared
              below.
            </span>
          </div>
        )}
        <label className="field">
          <span>Isolation</span>
          <select
            data-inspector-field="editor.isolation.mode"
            aria-label="Agent isolation"
            value={config.isolation?.mode ?? 'current-directory'}
            onChange={(event) => {
              if (event.target.value === 'workflow-run-worktree') {
                const {
                  workingDirectory: repositoryRoot = '',
                  ...withoutWorkingDirectory
                } = config;
                commit({
                  ...withoutWorkingDirectory,
                  isolation: {
                    mode: 'workflow-run-worktree',
                    repositoryRoot,
                    baseRef: 'HEAD',
                    scope: 'shared',
                  },
                });
                return;
              }
              update({ isolation: { mode: 'current-directory' } });
            }}
          >
            <option value="current-directory">Current working directory</option>
            <option value="workflow-run-worktree">Workflow-run worktree</option>
          </select>
          <small>
            Isolation is explicit and shared only by blocks using the same
            workflow-run scope.
          </small>
        </label>
        {config.isolation?.mode === 'workflow-run-worktree' && (
          <>
            <label className="field">
              <span>Git repository root</span>
              <div className="path-field">
                <input
                  data-inspector-field="editor.isolation.repositoryRoot"
                  aria-label="Worktree repository root"
                  value={config.isolation.repositoryRoot}
                  onChange={(event) =>
                    updateWorktreeIsolation(config, update, {
                      repositoryRoot: event.target.value,
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label="Choose worktree repository root"
                  onClick={() =>
                    void selectPath(
                      'directory',
                      config.isolation?.mode === 'workflow-run-worktree'
                        ? config.isolation.repositoryRoot
                        : undefined,
                    ).then((path) => {
                      if (path !== undefined) {
                        updateWorktreeIsolation(config, update, {
                          repositoryRoot: path,
                        });
                      }
                    })
                  }
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </label>
            <label className="field">
              <span>Base ref</span>
              <input
                data-inspector-field="editor.isolation.baseRef"
                aria-label="Worktree base ref"
                value={config.isolation.baseRef}
                onChange={(event) =>
                  updateWorktreeIsolation(config, update, {
                    baseRef: event.target.value,
                  })
                }
              />
              <small>
                The resolved commit is recorded when the run starts.
              </small>
            </label>
            <label className="field">
              <span>Shared scope</span>
              <input
                data-inspector-field="editor.isolation.scope"
                aria-label="Worktree scope"
                value={config.isolation.scope}
                onChange={(event) =>
                  updateWorktreeIsolation(config, update, {
                    scope: event.target.value,
                  })
                }
              />
              <small>
                Sequential agents with the same scope collaborate in one run
                worktree. Parallel writers need different scopes.
              </small>
            </label>
          </>
        )}
        {(config.isolation?.mode ?? 'current-directory') ===
          'current-directory' && (
          <label className="field">
            <span>Working directory</span>
            <div className="path-field">
              <input
                data-inspector-field="invocation.workingDirectory"
                value={config.workingDirectory ?? ''}
                placeholder="Workflow file directory"
                onChange={(event) => {
                  if (event.target.value !== '') {
                    update({ workingDirectory: event.target.value });
                    return;
                  }
                  const {
                    workingDirectory: _workingDirectory,
                    ...withoutWorkingDirectory
                  } = config;
                  commit(withoutWorkingDirectory);
                }}
              />
              <button
                className="icon-button"
                aria-label="Choose Agent working directory"
                onClick={() =>
                  void selectPath('directory', config.workingDirectory).then(
                    (path) => {
                      if (path !== undefined)
                        update({ workingDirectory: path });
                    },
                  )
                }
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <small>
              Leave blank to use the workflow file directory at run time.
            </small>
          </label>
        )}
      </section>

      <section className="inspector-section">
        <header>
          <span>Generated filesystem references</span>
          <button
            className="section-action"
            onClick={() =>
              update({
                filesystemOutputs: [
                  ...config.filesystemOutputs,
                  newFilesystemOutput(block, config.filesystemOutputs),
                ],
              })
            }
          >
            <Plus size={13} /> Add
          </button>
        </header>
        <p className="section-note">
          Declaring a path does not create it. {runtime.displayName} must
          produce it; Vorkflo verifies it after a successful run.
        </p>
        {config.filesystemOutputs.map((output, index) => (
          <div
            className="agent-output-row agent-file-output-row"
            key={output.portId}
          >
            <FileOutput size={14} />
            <input
              aria-label={`Generated output ${index + 1} name`}
              value={output.name}
              onChange={(event) =>
                updateFilesystemOutput(config, update, index, {
                  name: event.target.value,
                })
              }
            />
            <select
              data-inspector-field={`invocation.outputs[${index + 1}].entity`}
              aria-label={`Generated output ${index + 1} entity`}
              value={output.entity}
              onChange={(event) =>
                updateFilesystemOutput(config, update, index, {
                  entity: event.target.value as 'file' | 'directory',
                })
              }
            >
              <option value="file">File</option>
              <option value="directory">Directory</option>
            </select>
            <div className="path-field">
              <input
                data-inspector-field={`invocation.outputs[${index + 1}].path`}
                aria-label={`Generated output ${index + 1} path`}
                value={output.path}
                onChange={(event) =>
                  updateFilesystemOutput(config, update, index, {
                    path: event.target.value,
                  })
                }
              />
              <button
                className="icon-button"
                aria-label={`Choose generated output ${index + 1} path`}
                onClick={() =>
                  void selectPath(
                    output.entity === 'directory' ? 'directory' : 'output-file',
                    output.path,
                  ).then((path) => {
                    if (path !== undefined) {
                      updateFilesystemOutput(config, update, index, { path });
                    }
                  })
                }
              >
                <FolderOpen size={13} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={`Remove generated output ${output.name}`}
              onClick={() =>
                update({
                  filesystemOutputs: config.filesystemOutputs.filter(
                    (_, candidateIndex) => candidateIndex !== index,
                  ),
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {config.filesystemOutputs.length === 0 && (
          <div className="empty-line">No generated paths declared</div>
        )}
      </section>

      <section className="agent-compiled-contract">
        <header>
          <Bot size={14} />
          <strong>Compiled generic process</strong>
        </header>
        <InvocationPreview block={compileAgentBlock(config)} />
      </section>
    </div>
  );
}

function modelSelection(
  model: string | undefined,
  configuredModels: readonly string[],
): string {
  if (model === undefined) return 'runtime-default';
  const index = configuredModels.indexOf(model);
  return index < 0 ? 'custom' : `configured:${index}`;
}

function intelligenceProfileSelection(
  config: AgentBlockEditorConfig,
  profiles: readonly {
    readonly model: string;
    readonly reasoningEffort: string;
  }[],
): string {
  const index = profiles.findIndex(
    (profile) =>
      profile.model === config.model &&
      profile.reasoningEffort === config.reasoningEffort,
  );
  return index < 0 ? 'custom' : String(index);
}

function configuredContexts(
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

function defaultInstructionTemplate(
  contexts: readonly AgentNamedContextConfig[],
): string {
  if (contexts.length === 0) return '{{instruction}}';
  if (
    contexts.length === 1 &&
    contexts[0]?.templateKey === 'context' &&
    contexts[0]?.artifactKind === 'text'
  ) {
    return CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE;
  }
  return [
    '{{instruction}}',
    '',
    'Connected inputs:',
    ...contexts.flatMap((context) => [
      '',
      `${context.name}:`,
      `{{${context.templateKey}}}`,
    ]),
  ].join('\n');
}

function replaceContext(
  contexts: readonly AgentNamedContextConfig[],
  index: number,
  patch: Partial<AgentNamedContextConfig>,
): readonly AgentNamedContextConfig[] {
  return contexts.map((context, candidateIndex) =>
    candidateIndex === index ? { ...context, ...patch } : context,
  );
}

function newNamedContext(
  block: ProcessBlock,
  contexts: readonly AgentNamedContextConfig[],
): AgentNamedContextConfig {
  const portId = uniquePortId(block, 'context');
  let keyIndex = contexts.length + 1;
  const keys = new Set(contexts.map((context) => context.templateKey));
  while (keys.has(`context_${keyIndex}`)) keyIndex += 1;
  return {
    portId,
    name: `Context ${contexts.length + 1}`,
    artifactKind: 'text',
    templateKey: `context_${keyIndex}`,
    required: false,
  };
}

function updateOptionalString<
  Key extends 'outputSchemaPath' | 'outputLastMessagePath',
>(
  config: AgentBlockEditorConfig,
  commit: (config: AgentBlockEditorConfig) => void,
  key: Key,
  value: string,
): void {
  if (value !== '') {
    commit({ ...config, [key]: value });
    return;
  }
  const next = { ...config };
  delete next[key];
  commit(next);
}

function updateFilesystemOutput(
  config: AgentBlockEditorConfig,
  update: (patch: Partial<AgentBlockEditorConfig>) => void,
  index: number,
  patch: Partial<AgentFilesystemOutputConfig>,
): void {
  update({
    filesystemOutputs: config.filesystemOutputs.map((output, candidateIndex) =>
      candidateIndex === index ? { ...output, ...patch } : output,
    ),
  });
}

function updateWorktreeIsolation(
  config: AgentBlockEditorConfig,
  update: (patch: Partial<AgentBlockEditorConfig>) => void,
  patch: Partial<WorktreeIsolationConfig>,
): void {
  if (config.isolation?.mode !== 'workflow-run-worktree') return;
  update({ isolation: { ...config.isolation, ...patch } });
}

function presentationFromConfig(
  config: AgentBlockEditorConfig,
): AgentBlockPresentation {
  return {
    kind: 'ai-agent',
    agentRuntime: config.agentRuntime,
    ...(config.isolation === undefined ? {} : { isolation: config.isolation }),
  };
}

function instructionDeliveryLabel(mode: AgentInstructionDeliveryMode): string {
  switch (mode) {
    case 'argument':
      return 'Exact CLI argument';
    case 'template':
      return 'Deterministic argument template';
    case 'stdin':
      return 'Standard input';
    case 'file':
      return 'Run-local instruction file';
  }
}

function authorityLabel(
  runtime: AgentRuntimeId,
  authority: AgentBlockEditorConfig['authority'],
): string {
  if (authority === 'workspace-write') return 'Workspace write';
  if (runtime === 'cline') return 'Plan mode (behavioral read only)';
  if (runtime === 'antigravity') return 'Sandboxed read-only intent';
  return 'Read only';
}

function newFilesystemOutput(
  block: ProcessBlock,
  current: readonly AgentFilesystemOutputConfig[],
): AgentFilesystemOutputConfig {
  const portId = uniquePortId(block, 'generated');
  return {
    portId,
    name: `Generated ${current.length + 1}`,
    path: `./generated-${current.length + 1}.txt`,
    entity: 'file',
  };
}

function uniquePortId(block: ProcessBlock, prefix: string): string {
  const used = new Set([
    ...block.inputs.map((port) => port.id),
    ...block.outputs.map((port) => port.id),
  ]);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
