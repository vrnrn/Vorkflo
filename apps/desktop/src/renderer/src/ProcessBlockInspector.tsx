import {
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  type ArtifactKind,
  type BlockPreflightPreview,
  type ProcessArgument,
  type ProcessBlock,
  type ProcessStdin,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import {
  AlertTriangle,
  FolderOpen,
  GripVertical,
  Info,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { InvocationPreview } from './InvocationPreview';
import {
  addInputPort,
  addOutputPort,
  moveListItem,
  moveRecordEntry,
  removeInputPort,
  removeOutputPort,
} from './workflow';
import {
  InspectorSection,
  Field,
  ArtifactOptions,
  EmptyLine,
} from './InspectorPrimitives';

/** Process configuration and ordering; the application shell owns workflow history. */
type ReorderGroup = 'arguments' | 'inputs' | 'outputs' | 'environment';
type ReorderLocation = { group: ReorderGroup; index: number };
export function ProcessBlockInspector({
  block,
  workflow,
  resolved,
  selectPath,
  onChange,
  onWorkflowChange,
}: {
  block: ProcessBlock;
  workflow: WorkflowDefinition;
  resolved?: BlockPreflightPreview;
  selectPath: (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ) => Promise<string | undefined>;
  onChange: (block: ProcessBlock) => void;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
}) {
  const [draggedRow, setDraggedRow] = useState<ReorderLocation>();
  const [dropTarget, setDropTarget] = useState<ReorderLocation>();

  const patchInvocation = (patch: Partial<ProcessBlock['invocation']>): void =>
    onChange({ ...block, invocation: { ...block.invocation, ...patch } });

  const startReorder = (
    group: ReorderGroup,
    index: number,
    event: ReactDragEvent<HTMLButtonElement>,
  ): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${group}:${index}`);
    setDraggedRow({ group, index });
    setDropTarget(undefined);
  };

  const finishReorder = (): void => {
    setDraggedRow(undefined);
    setDropTarget(undefined);
  };

  const reorderTargetProps = (
    group: ReorderGroup,
    index: number,
    onMove: (fromIndex: number, toIndex: number) => void,
  ) => ({
    onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      setDropTarget({ group, index });
    },
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (draggedRow?.group !== group) return;
      event.preventDefault();
      if (draggedRow.index !== index) onMove(draggedRow.index, index);
      finishReorder();
    },
  });

  const reorderRowClass = (
    baseClass: string,
    group: ReorderGroup,
    index: number,
  ): string =>
    [
      baseClass,
      'reorder-row',
      draggedRow?.group === group && draggedRow.index === index
        ? 'is-dragging'
        : '',
      dropTarget?.group === group &&
      dropTarget.index === index &&
      draggedRow?.index !== index
        ? 'is-drop-target'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div className="inspector-scroll">
      <InspectorSection title="Identity">
        <Field label="Display name">
          <input
            data-inspector-field="identity.name"
            value={block.name}
            onChange={(event) =>
              onChange({ ...block, name: event.target.value })
            }
          />
        </Field>
      </InspectorSection>

      <InspectorSection title="Invocation">
        <Field
          label="Executable"
          hint="Resolved using the declared PATH binding"
        >
          <input
            data-inspector-field="invocation.executable"
            className="mono"
            value={block.invocation.executable}
            onChange={(event) =>
              patchInvocation({ executable: event.target.value })
            }
            spellCheck={false}
          />
        </Field>
        <Field
          label="Working directory"
          hint="Leave blank to use the application working directory"
        >
          <div className="path-field">
            <input
              data-inspector-field="invocation.workingDirectory"
              className="mono"
              value={block.invocation.workingDirectory ?? ''}
              placeholder="Workflow file directory"
              onChange={(event) =>
                patchInvocation(
                  event.target.value.trim() === ''
                    ? { workingDirectory: undefined }
                    : { workingDirectory: event.target.value },
                )
              }
              spellCheck={false}
            />
            <button
              className="icon-button"
              aria-label="Choose working directory"
              onClick={() =>
                void selectPath(
                  'directory',
                  block.invocation.workingDirectory,
                ).then((path) => {
                  if (path !== undefined) {
                    patchInvocation({ workingDirectory: path });
                  }
                })
              }
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </Field>
        <label className="toggle-row shell-toggle">
          <span>
            <strong>Evaluate through shell</strong>
            <small>Enables expansion, pipes, and redirects</small>
          </span>
          <input
            data-inspector-field="invocation.shell"
            type="checkbox"
            checked={block.invocation.shell}
            onChange={(event) =>
              patchInvocation({ shell: event.target.checked })
            }
          />
          <span className="toggle" />
        </label>
        {block.invocation.shell && (
          <div className="inline-warning">
            <AlertTriangle size={14} />
            <span>
              Shell mode expands the command's authority. Review every argument
              before running.
            </span>
          </div>
        )}
      </InspectorSection>

      <InspectorSection
        title="Arguments"
        action={
          <button
            className="section-action"
            onClick={() =>
              patchInvocation({
                arguments: [
                  ...block.invocation.arguments,
                  { type: 'literal', value: '' },
                ],
              })
            }
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        <div className="argument-list">
          {block.invocation.arguments.map((argument, index) =>
            argument.type === 'literal' ? (
              <div
                className={reorderRowClass('argument-row', 'arguments', index)}
                key={index}
                {...reorderTargetProps('arguments', index, (from, to) =>
                  patchInvocation({
                    arguments: moveListItem(
                      block.invocation.arguments,
                      from,
                      to,
                    ),
                  }),
                )}
              >
                <ReorderHandle
                  label={`argument ${index + 1}`}
                  onDragStart={(event) =>
                    startReorder('arguments', index, event)
                  }
                  onDragEnd={finishReorder}
                  onMove={(offset) =>
                    patchInvocation({
                      arguments: moveListItem(
                        block.invocation.arguments,
                        index,
                        index + offset,
                      ),
                    })
                  }
                />
                <span>{index + 1}</span>
                <input
                  data-inspector-field={`invocation.arguments[${index}]`}
                  className="mono"
                  value={argument.value}
                  aria-label={`Argument ${index + 1}`}
                  onChange={(event) => {
                    const arguments_ = [...block.invocation.arguments];
                    arguments_[index] = {
                      type: 'literal',
                      value: event.target.value,
                    };
                    patchInvocation({ arguments: arguments_ });
                  }}
                />
                <button
                  className="icon-button"
                  aria-label={`Remove argument ${index + 1}`}
                  onClick={() =>
                    patchInvocation({
                      arguments: block.invocation.arguments.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ) : argument.type === 'input' ? (
              <div
                className={reorderRowClass(
                  'argument-row input-binding',
                  'arguments',
                  index,
                )}
                key={`input:${argument.portId}`}
                {...reorderTargetProps('arguments', index, (from, to) =>
                  patchInvocation({
                    arguments: moveListItem(
                      block.invocation.arguments,
                      from,
                      to,
                    ),
                  }),
                )}
              >
                <ReorderHandle
                  label={`input argument ${argument.portId}`}
                  onDragStart={(event) =>
                    startReorder('arguments', index, event)
                  }
                  onDragEnd={finishReorder}
                  onMove={(offset) =>
                    patchInvocation({
                      arguments: moveListItem(
                        block.invocation.arguments,
                        index,
                        index + offset,
                      ),
                    })
                  }
                />
                <span>{index + 1}</span>
                <code>input:{argument.portId}</code>
                <small>bound port</small>
              </div>
            ) : (
              <div
                className={reorderRowClass(
                  'argument-row input-binding',
                  'arguments',
                  index,
                )}
                key={`template:${index}`}
                {...reorderTargetProps('arguments', index, (from, to) =>
                  patchInvocation({
                    arguments: moveListItem(
                      block.invocation.arguments,
                      from,
                      to,
                    ),
                  }),
                )}
              >
                <ReorderHandle
                  label={`template argument ${index + 1}`}
                  onDragStart={(event) =>
                    startReorder('arguments', index, event)
                  }
                  onDragEnd={finishReorder}
                  onMove={(offset) =>
                    patchInvocation({
                      arguments: moveListItem(
                        block.invocation.arguments,
                        index,
                        index + offset,
                      ),
                    })
                  }
                />
                <span>{index + 1}</span>
                <code>template:{argument.template}</code>
                <small>
                  {Object.keys(argument.inputs).length} template bindings
                </small>
              </div>
            ),
          )}
          {block.invocation.arguments.length === 0 && (
            <EmptyLine text="No command arguments" />
          )}
        </div>
      </InspectorSection>

      <InspectorSection
        title="Input ports"
        action={
          <button
            className="section-action"
            onClick={() => onChange(addInputPort(block))}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {block.inputs.map((port, index) => (
          <div
            className={reorderRowClass('port-editor', 'inputs', index)}
            key={port.id}
            {...reorderTargetProps('inputs', index, (from, to) =>
              onChange({
                ...block,
                inputs: moveListItem(block.inputs, from, to),
              }),
            )}
          >
            <div className={`kind-bar kind-${port.artifactKind}`} />
            <ReorderHandle
              label={`input port ${port.name}`}
              onDragStart={(event) => startReorder('inputs', index, event)}
              onDragEnd={finishReorder}
              onMove={(offset) =>
                onChange({
                  ...block,
                  inputs: moveListItem(block.inputs, index, index + offset),
                })
              }
            />
            <input
              data-inspector-field={`inputs[${index}].name`}
              value={port.name}
              aria-label="Input name"
              onChange={(event) =>
                onChange({
                  ...block,
                  inputs: block.inputs.map((candidate) =>
                    candidate.id === port.id
                      ? { ...candidate, name: event.target.value }
                      : candidate,
                  ),
                })
              }
            />
            <select
              data-inspector-field={`inputs[${index}].artifactKind`}
              value={port.artifactKind}
              onChange={(event) =>
                onChange({
                  ...block,
                  inputs: block.inputs.map((candidate) =>
                    candidate.id === port.id
                      ? {
                          ...candidate,
                          artifactKind: event.target.value as ArtifactKind,
                        }
                      : candidate,
                  ),
                })
              }
            >
              <ArtifactOptions />
            </select>
            <select
              data-inspector-field={`inputs[${index}].delivery`}
              aria-label="Input delivery"
              value={inputDelivery(block, port.id)}
              onChange={(event) => {
                const without = block.invocation.arguments.filter(
                  (argument) => !argumentUsesInputPort(argument, port.id),
                );
                patchInvocation({
                  arguments:
                    event.target.value === 'argument'
                      ? [...without, { type: 'input', portId: port.id }]
                      : without,
                  stdin:
                    event.target.value === 'stdin'
                      ? { portId: port.id }
                      : stdinUsesInputPort(block.invocation.stdin, port.id)
                        ? undefined
                        : block.invocation.stdin,
                });
              }}
            >
              <option value="argument">Argument</option>
              <option value="stdin">stdin</option>
              {inputDelivery(block, port.id) === 'template' && (
                <option value="template">Template</option>
              )}
            </select>
            <button
              className="icon-button"
              aria-label={`Remove input port ${port.name}`}
              onClick={() =>
                onWorkflowChange(removeInputPort(workflow, block, port.id))
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {block.inputs.length === 0 && (
          <EmptyLine text="No incoming artifacts" />
        )}
      </InspectorSection>

      <InspectorSection
        title="Output ports"
        action={
          <button
            className="section-action"
            onClick={() => onChange(addOutputPort(block))}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {block.outputs.map((port, index) => {
          const binding = block.invocation.outputs.find(
            (candidate) => candidate.portId === port.id,
          );
          return (
            <div
              className={reorderRowClass(
                'port-editor output-editor',
                'outputs',
                index,
              )}
              key={port.id}
              {...reorderTargetProps('outputs', index, (from, to) =>
                onChange({
                  ...block,
                  outputs: moveListItem(block.outputs, from, to),
                }),
              )}
            >
              <div className={`kind-bar kind-${port.artifactKind}`} />
              <ReorderHandle
                label={`output port ${port.name}`}
                onDragStart={(event) => startReorder('outputs', index, event)}
                onDragEnd={finishReorder}
                onMove={(offset) =>
                  onChange({
                    ...block,
                    outputs: moveListItem(block.outputs, index, index + offset),
                  })
                }
              />
              <input
                data-inspector-field={`outputs[${index}].name`}
                value={port.name}
                aria-label="Output name"
                onChange={(event) =>
                  onChange({
                    ...block,
                    outputs: block.outputs.map((candidate) =>
                      candidate.id === port.id
                        ? { ...candidate, name: event.target.value }
                        : candidate,
                    ),
                  })
                }
              />
              <select
                data-inspector-field={`outputs[${index}].artifactKind`}
                value={port.artifactKind}
                onChange={(event) => {
                  const artifactKind = event.target.value as ArtifactKind;
                  const outputs = block.outputs.map((candidate) =>
                    candidate.id === port.id
                      ? { ...candidate, artifactKind }
                      : candidate,
                  );
                  const bindings = block.invocation.outputs.filter(
                    (candidate) => candidate.portId !== port.id,
                  );
                  const nextBinding =
                    artifactKind === 'filesystem-reference'
                      ? {
                          type: 'filesystem' as const,
                          portId: port.id,
                          path: './output',
                        }
                      : { type: 'stdout' as const, portId: port.id };
                  onChange({
                    ...block,
                    outputs,
                    invocation: {
                      ...block.invocation,
                      outputs: [...bindings, nextBinding],
                    },
                  });
                }}
              >
                <ArtifactOptions />
              </select>
              <button
                className="icon-button"
                aria-label={`Remove output port ${port.name}`}
                onClick={() =>
                  onWorkflowChange(removeOutputPort(workflow, block, port.id))
                }
              >
                <Trash2 size={13} />
              </button>
              <div className="binding-row">
                <span>Binding</span>
                <code>{binding?.type ?? 'missing'}</code>
                {binding?.type === 'filesystem' && (
                  <>
                    <select
                      data-inspector-field={`invocation.outputs[${block.invocation.outputs.findIndex((candidate) => candidate.portId === port.id)}].entity`}
                      aria-label="Output entity"
                      value={binding.entity ?? 'unknown'}
                      onChange={(event) =>
                        patchInvocation({
                          outputs: block.invocation.outputs.map((candidate) =>
                            candidate.portId === port.id &&
                            candidate.type === 'filesystem'
                              ? {
                                  ...candidate,
                                  entity: event.target.value as
                                    'file' | 'directory' | 'unknown',
                                }
                              : candidate,
                          ),
                        })
                      }
                    >
                      <option value="file">File</option>
                      <option value="directory">Directory</option>
                      <option value="unknown">File or directory</option>
                    </select>
                    <div className="path-field">
                      <input
                        data-inspector-field={`invocation.outputs[${block.invocation.outputs.findIndex((candidate) => candidate.portId === port.id)}].path`}
                        className="mono"
                        aria-label="Output path"
                        value={binding.path}
                        onChange={(event) =>
                          patchInvocation({
                            outputs: block.invocation.outputs.map(
                              (candidate) =>
                                candidate.portId === port.id &&
                                candidate.type === 'filesystem'
                                  ? { ...candidate, path: event.target.value }
                                  : candidate,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={`Choose output path for ${port.name}`}
                        onClick={() =>
                          void selectPath(
                            binding.entity === 'directory'
                              ? 'directory'
                              : 'output-file',
                            binding.path,
                          ).then((path) => {
                            if (path !== undefined) {
                              patchInvocation({
                                outputs: block.invocation.outputs.map(
                                  (candidate) =>
                                    candidate.portId === port.id &&
                                    candidate.type === 'filesystem'
                                      ? { ...candidate, path }
                                      : candidate,
                                ),
                              });
                            }
                          })
                        }
                      >
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {block.outputs.length === 0 && (
          <EmptyLine text="No produced artifacts" />
        )}
      </InspectorSection>

      <InspectorSection
        title="Environment"
        action={
          <button
            className="section-action"
            onClick={() => {
              let index = 1;
              while (`VARIABLE_${index}` in block.invocation.environment)
                index += 1;
              patchInvocation({
                environment: {
                  ...block.invocation.environment,
                  [`VARIABLE_${index}`]: {
                    source: 'host',
                    name: `VARIABLE_${index}`,
                  },
                },
              });
            }}
          >
            <Plus size={13} /> Add
          </button>
        }
      >
        {Object.entries(block.invocation.environment).map(
          ([key, value], index) => (
            <div
              className={reorderRowClass(
                'environment-row',
                'environment',
                index,
              )}
              key={key}
              {...reorderTargetProps('environment', index, (from, to) =>
                patchInvocation({
                  environment: moveRecordEntry(
                    block.invocation.environment,
                    from,
                    to,
                  ),
                }),
              )}
            >
              <ReorderHandle
                label={`environment variable ${key}`}
                onDragStart={(event) =>
                  startReorder('environment', index, event)
                }
                onDragEnd={finishReorder}
                onMove={(offset) =>
                  patchInvocation({
                    environment: moveRecordEntry(
                      block.invocation.environment,
                      index,
                      index + offset,
                    ),
                  })
                }
              />
              <EnvironmentRow
                name={key}
                value={value}
                onChange={(nextName, nextValue) => {
                  const environment = { ...block.invocation.environment };
                  const entries = Object.entries(environment).map(
                    ([candidateName, candidateValue]) =>
                      candidateName === key
                        ? ([nextName, nextValue] as const)
                        : ([candidateName, candidateValue] as const),
                  );
                  patchInvocation({ environment: Object.fromEntries(entries) });
                }}
                onRemove={() => {
                  const environment = { ...block.invocation.environment };
                  delete environment[key];
                  patchInvocation({ environment });
                }}
              />
            </div>
          ),
        )}
        {Object.keys(block.invocation.environment).length === 0 && (
          <EmptyLine text="No environment access declared" />
        )}
        <p className="section-note">
          <Info size={12} /> Host values are referenced by name. Literal values
          are stored in the workflow—do not put secrets there.
        </p>
      </InspectorSection>
      <InspectorSection title="Invocation preview">
        <InvocationPreview
          block={block}
          {...(resolved === undefined ? {} : { resolved })}
        />
      </InspectorSection>
    </div>
  );
}

type EnvironmentValue = ProcessBlock['invocation']['environment'][string];

function ReorderHandle({
  label,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  label: string;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(event.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <button
      type="button"
      className="reorder-handle"
      draggable
      aria-label={`Reorder ${label}`}
      title="Drag to reorder; use Up and Down arrow keys for keyboard control"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={handleKeyDown}
    >
      <GripVertical size={14} />
    </button>
  );
}

function EnvironmentRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  value: EnvironmentValue;
  onChange: (name: string, value: EnvironmentValue) => void;
  onRemove: () => void;
}) {
  const source = value.source === 'input' ? 'host' : value.source;
  return (
    <>
      <input
        data-inspector-field={`invocation.environment.${name}`}
        className="mono"
        value={name}
        aria-label="Environment variable"
        onChange={(event) => onChange(event.target.value, value)}
      />
      <select
        aria-label={`Environment source for ${name}`}
        value={source}
        onChange={(event) =>
          onChange(
            name,
            event.target.value === 'literal'
              ? { source: 'literal', value: '' }
              : { source: 'host', name },
          )
        }
      >
        <option value="host">Host ref</option>
        <option value="literal">Literal</option>
      </select>
      <input
        className="mono"
        aria-label="Environment value"
        value={
          value.source === 'literal'
            ? value.value
            : value.source === 'host'
              ? value.name
              : value.portId
        }
        onChange={(event) =>
          onChange(
            name,
            value.source === 'literal'
              ? { source: 'literal', value: event.target.value }
              : { source: 'host', name: event.target.value },
          )
        }
      />
      <button
        className="icon-button"
        aria-label={`Remove environment variable ${name}`}
        onClick={onRemove}
      >
        <Trash2 size={13} />
      </button>
    </>
  );
}

function inputDelivery(
  block: ProcessBlock,
  portId: string,
): 'argument' | 'stdin' | 'template' {
  if (stdinUsesInputPort(block.invocation.stdin, portId)) return 'stdin';
  if (
    block.invocation.arguments.some(
      (argument) =>
        argument.type === 'template' && argumentUsesInputPort(argument, portId),
    )
  ) {
    return 'template';
  }
  return 'argument';
}

function argumentUsesInputPort(
  argument: ProcessArgument,
  portId: string,
): boolean {
  if (argument.type === 'input') return argument.portId === portId;
  if (argument.type !== 'template') return false;
  return Object.values(argument.inputs).some(
    (binding) => 'portId' in binding && binding.portId === portId,
  );
}

function stdinUsesInputPort(
  stdin: ProcessStdin | undefined,
  portId: string,
): boolean {
  if (stdin === undefined) return false;
  if ('portId' in stdin) return stdin.portId === portId;
  return Object.values(stdin.inputs).some(
    (binding) => 'portId' in binding && binding.portId === portId,
  );
}
