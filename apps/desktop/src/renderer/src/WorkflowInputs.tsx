import type {
  ArtifactKind,
  JsonValue,
  WorkflowDefinition,
  WorkflowInput,
  WorkflowRunInputValue,
} from '@vorkflo/engine';
import { FileInput, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addWorkflowInput,
  bindWorkflowInput,
  removeWorkflowInput,
  serializeRunInputValue,
  unbindWorkflowInput,
  updateWorkflowInput,
} from './workflow-inputs';

interface PathSelector {
  (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ): Promise<string | undefined>;
}

export function WorkflowInputsEditor({
  workflow,
  onChange,
  selectPath,
}: {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
  selectPath: PathSelector;
}) {
  return (
    <section className="workflow-inputs-panel" aria-label="Workflow inputs">
      <header>
        <div>
          <small>RUN INPUTS</small>
          <strong>Workflow inputs</strong>
        </div>
        <button
          className="section-action"
          onClick={() => onChange(addWorkflowInput(workflow).workflow)}
        >
          <Plus size={13} /> Add
        </button>
      </header>
      <p className="section-note">
        Values are requested for each manual run. Defaults are portable
        literals; do not store secrets here.
      </p>
      {workflow.inputs.map((input) => {
        const binding = workflow.inputBindings.find(
          (candidate) => candidate.inputId === input.id,
        );
        const targetValue =
          binding === undefined
            ? ''
            : `${binding.to.blockId}\u0000${binding.to.portId}`;
        return (
          <article className="workflow-input-card" key={input.id}>
            <div className="workflow-input-heading">
              <FileInput size={14} />
              <input
                aria-label={`Workflow input ${input.id} name`}
                value={input.name}
                onChange={(event) =>
                  onChange(
                    updateWorkflowInput(workflow, {
                      ...input,
                      name: event.target.value,
                    }),
                  )
                }
              />
              <button
                className="icon-button"
                aria-label={`Remove workflow input ${input.name}`}
                onClick={() =>
                  onChange(removeWorkflowInput(workflow, input.id))
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="workflow-input-grid">
              <label>
                <span>Kind</span>
                <select
                  aria-label={`Workflow input ${input.name} kind`}
                  value={input.artifactKind}
                  onChange={(event) => {
                    const { defaultValue: _defaultValue, ...withoutDefault } =
                      input;
                    onChange(
                      updateWorkflowInput(workflow, {
                        ...withoutDefault,
                        artifactKind: event.target.value as ArtifactKind,
                      }),
                    );
                  }}
                >
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                  <option value="filesystem-reference">File reference</option>
                </select>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={input.required}
                  onChange={(event) =>
                    onChange(
                      updateWorkflowInput(workflow, {
                        ...input,
                        required: event.target.checked,
                      }),
                    )
                  }
                />
                Required
              </label>
            </div>
            <label className="workflow-input-target">
              <span>Deliver to block input</span>
              <select
                aria-label={`Workflow input ${input.name} target`}
                value={targetValue}
                onChange={(event) => {
                  if (event.target.value === '') {
                    if (binding !== undefined) {
                      onChange(
                        unbindWorkflowInput(
                          workflow,
                          binding.to.blockId,
                          binding.to.portId,
                        ),
                      );
                    }
                    return;
                  }
                  const [blockId, portId] = event.target.value.split('\u0000');
                  if (blockId !== undefined && portId !== undefined) {
                    onChange(
                      bindWorkflowInput(workflow, input.id, blockId, portId),
                    );
                  }
                }}
              >
                <option value="">Not bound</option>
                {workflow.blocks.flatMap((block) =>
                  block.inputs
                    .filter((port) => port.artifactKind === input.artifactKind)
                    .map((port) => (
                      <option
                        key={`${block.id}:${port.id}`}
                        value={`${block.id}\u0000${port.id}`}
                      >
                        {block.name} › {port.name}
                      </option>
                    )),
                )}
              </select>
            </label>
            <DefaultValueEditor
              input={input}
              selectPath={selectPath}
              onChange={(defaultValue) =>
                onChange(updateInputDefault(workflow, input, defaultValue))
              }
            />
          </article>
        );
      })}
      {workflow.inputs.length === 0 && (
        <div className="empty-line">No workflow inputs declared</div>
      )}
    </section>
  );
}

function updateInputDefault(
  workflow: WorkflowDefinition,
  input: WorkflowInput,
  defaultValue: WorkflowRunInputValue | undefined,
): WorkflowDefinition {
  const { defaultValue: _currentDefault, ...withoutDefault } = input;
  return updateWorkflowInput(workflow, {
    ...withoutDefault,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });
}

function DefaultValueEditor({
  input,
  onChange,
  selectPath,
}: {
  input: WorkflowInput;
  onChange: (value: WorkflowRunInputValue | undefined) => void;
  selectPath: PathSelector;
}) {
  if (input.defaultValue === undefined) {
    return (
      <button
        className="default-value-action"
        onClick={() => {
          if (input.artifactKind === 'text') {
            onChange({ kind: 'text', value: '' });
          } else if (input.artifactKind === 'json') {
            onChange({ kind: 'json', value: null });
          } else {
            onChange({
              kind: 'filesystem-reference',
              path: './input',
              entity: 'unknown',
            });
          }
        }}
      >
        <Plus size={12} /> Store portable default
      </button>
    );
  }
  const defaultValue = input.defaultValue;

  if (defaultValue.kind === 'json') {
    return (
      <JsonDefaultValueEditor
        inputName={input.name}
        value={defaultValue.value}
        onChange={(value) => onChange({ kind: 'json', value })}
        onRemove={() => onChange(undefined)}
      />
    );
  }

  return (
    <div className="default-value-editor">
      <label>
        <span>Stored default</span>
        <input
          aria-label={`Stored default for ${input.name}`}
          value={serializeRunInputValue(defaultValue)}
          onChange={(event) => {
            if (defaultValue.kind === 'text') {
              onChange({ kind: 'text', value: event.target.value });
            } else {
              onChange({ ...defaultValue, path: event.target.value });
            }
          }}
        />
      </label>
      {defaultValue.kind === 'filesystem-reference' && (
        <>
          <select
            aria-label={`Stored default entity for ${input.name}`}
            value={defaultValue.entity ?? 'unknown'}
            onChange={(event) =>
              onChange({
                ...defaultValue,
                entity: event.target.value as 'file' | 'directory' | 'unknown',
              })
            }
          >
            <option value="unknown">File or directory</option>
            <option value="file">File</option>
            <option value="directory">Directory</option>
          </select>
          <button
            className="icon-button"
            aria-label={`Choose default path for ${input.name}`}
            onClick={() =>
              void selectPath(
                defaultValue.entity === 'directory' ? 'directory' : 'file',
                defaultValue.path,
              ).then((path) => {
                if (path !== undefined) {
                  onChange({
                    ...defaultValue,
                    path,
                    entity:
                      defaultValue.entity === 'directory'
                        ? 'directory'
                        : 'file',
                  });
                }
              })
            }
          >
            <FolderOpen size={13} />
          </button>
        </>
      )}
      <button
        className="icon-button"
        aria-label={`Remove stored default for ${input.name}`}
        onClick={() => onChange(undefined)}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function JsonDefaultValueEditor({
  inputName,
  value,
  onChange,
  onRemove,
}: {
  inputName: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  onRemove: () => void;
}) {
  const serialized = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string>();

  useEffect(() => setDraft(serialized), [serialized]);

  return (
    <div className="default-value-editor json-default-value-editor">
      <label>
        <span>Stored JSON default</span>
        <textarea
          aria-label={`Stored JSON default for ${inputName}`}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            try {
              onChange(JSON.parse(next) as JsonValue);
              setError(undefined);
            } catch {
              setError('Enter valid JSON to update the stored default.');
            }
          }}
        />
        {error !== undefined && <small role="alert">{error}</small>}
      </label>
      <button
        className="icon-button"
        aria-label={`Remove stored default for ${inputName}`}
        onClick={onRemove}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function RunInputFields({
  workflow,
  values,
  errors,
  onChange,
  selectPath,
}: {
  workflow: WorkflowDefinition;
  values: Readonly<Record<string, string>>;
  errors: Readonly<Record<string, string>>;
  onChange: (inputId: string, value: string) => void;
  selectPath: PathSelector;
}) {
  if (workflow.inputs.length === 0) return null;
  return (
    <section className="run-input-fields" aria-label="Manual run inputs">
      <header>
        <FileInput size={14} />
        <strong>Run inputs</strong>
        <span>Values remain in sensitive local run history.</span>
      </header>
      {workflow.inputs.map((input) => {
        const value = values[input.id] ?? '';
        return (
          <label key={input.id} className={errors[input.id] ? 'invalid' : ''}>
            <span>
              {input.name} <em>{input.artifactKind}</em>
            </span>
            <div>
              {input.artifactKind === 'json' ? (
                <textarea
                  data-run-input-id={input.id}
                  aria-label={`${input.name} (${input.artifactKind})`}
                  value={value}
                  placeholder={serializeRunInputValue(input.defaultValue)}
                  onChange={(event) => onChange(input.id, event.target.value)}
                />
              ) : (
                <input
                  data-run-input-id={input.id}
                  aria-label={`${input.name} (${input.artifactKind})`}
                  value={value}
                  placeholder={serializeRunInputValue(input.defaultValue)}
                  onChange={(event) => onChange(input.id, event.target.value)}
                />
              )}
              {input.artifactKind === 'filesystem-reference' && (
                <span className="filesystem-input-actions">
                  <button
                    type="button"
                    className="button"
                    aria-label={`Choose file input ${input.name}`}
                    onClick={() =>
                      void selectPath('file', value || undefined).then(
                        (path) => {
                          if (path !== undefined) onChange(input.id, path);
                        },
                      )
                    }
                  >
                    <FolderOpen size={13} /> File
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Choose directory input ${input.name}`}
                    onClick={() =>
                      void selectPath('directory', value || undefined).then(
                        (path) => {
                          if (path !== undefined) onChange(input.id, path);
                        },
                      )
                    }
                  >
                    <FolderOpen size={13} /> Directory
                  </button>
                </span>
              )}
            </div>
            {errors[input.id] && <small>{errors[input.id]}</small>}
            {value === '' && input.defaultValue !== undefined && (
              <small>Using stored workflow default.</small>
            )}
          </label>
        );
      })}
    </section>
  );
}
