import type { ProcessBlock } from '@vorkflo/engine';
import { useEffect, useState, type ReactNode } from 'react';
import {
  FileText,
  FolderOpen,
  MonitorUp,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
} from 'lucide-react';
import {
  compileComputerUseBlock,
  type ComputerUseBlockConfig,
  type ComputerUseBlockPresentation,
  type ComputerUseReasoningEffort,
} from '../../shared/computer-use-runtime';
import { InvocationPreview } from './InvocationPreview';

interface ComputerUseBlockInspectorProps {
  readonly block: ProcessBlock;
  readonly presentation: ComputerUseBlockPresentation;
  readonly selectPath: (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ) => Promise<string | undefined>;
  readonly onChange: (
    block: ProcessBlock,
    presentation: ComputerUseBlockPresentation,
  ) => void;
}

export function ComputerUseBlockInspector({
  block,
  presentation,
  selectPath,
  onChange,
}: ComputerUseBlockInspectorProps) {
  const [config, setConfig] = useState(presentation.config);
  const [validationError, setValidationError] = useState<string>();
  useEffect(() => {
    setConfig(presentation.config);
    setValidationError(undefined);
  }, [presentation.config]);
  // Permit incomplete edits locally, but only publish a valid configuration.
  // This keeps the current executable contract stable while URLs and paths are edited.
  const commit = (next: ComputerUseBlockConfig): void => {
    setConfig(next);
    try {
      const compiled = compileComputerUseBlock(next);
      setValidationError(undefined);
      onChange(compiled, { kind: 'computer-use', config: next });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const update = (patch: Partial<ComputerUseBlockConfig>): void =>
    commit({ ...config, ...patch });
  const clearOptional = (
    field: 'model' | 'reasoningEffort' | 'workingDirectory' | 'screenshotPath',
  ): void => {
    const next = { ...config };
    delete next[field];
    commit(next);
  };

  const choosePath = async (
    field:
      | 'workingDirectory'
      | 'mcpPolicyProxyScript'
      | 'mcpPolicyManifestPath'
      | 'reportPath'
      | 'screenshotPath',
    kind: 'file' | 'directory' | 'output-file',
  ): Promise<void> => {
    const path = await selectPath(kind, config[field]);
    if (path !== undefined) update({ [field]: path });
  };

  return (
    <div className="inspector-scroll computer-use-inspector">
      {validationError !== undefined && (
        <div className="inline-warning" role="alert">
          Changes not applied: {validationError}
        </div>
      )}
      <section className="inspector-section">
        <SectionHeading icon={<MonitorUp size={13} />} label="Browser task">
          <span className="authority-pill">Research only</span>
        </SectionHeading>
        <div className="computer-use-boundary-card">
          <ShieldCheck size={15} />
          <span>
            <strong>Bounded browser session</strong>
            <small>
              MCP tools, call count, timeout, and evidence outputs are explicit
              before execution.
            </small>
          </span>
        </div>
        <Field label="Display name" field="editor.computerUse.name">
          <input
            value={config.name}
            onChange={(event) =>
              update({ name: event.target.value, id: block.id })
            }
          />
        </Field>
        <Field label="Task subject" field="editor.computerUse.subject">
          <input
            value={config.subject ?? ''}
            onChange={(event) => update({ subject: event.target.value })}
          />
        </Field>
        <Field label="Start URL" field="editor.computerUse.startUrl">
          <input
            value={config.startUrl}
            onChange={(event) => update({ startUrl: event.target.value })}
          />
        </Field>
        <Field
          label="Allowed origins"
          field="editor.computerUse.allowedOrigins"
          help="One HTTPS scheme and host per line. The start URL must match."
        >
          <textarea
            rows={3}
            value={config.allowedOrigins.join('\n')}
            onChange={(event) =>
              update({ allowedOrigins: lines(event.target.value) })
            }
          />
        </Field>
      </section>

      <section className="inspector-section">
        <SectionHeading
          icon={<SlidersHorizontal size={13} />}
          label="Codex controller"
        />
        <Field
          label="Dedicated Codex profile"
          field="editor.computerUse.profile"
          help="Use a profile dedicated to the bounded browser MCP server."
        >
          <input
            value={config.codexProfile}
            onChange={(event) => update({ codexProfile: event.target.value })}
          />
        </Field>
        <Field label="MCP server name" field="editor.computerUse.mcpServer">
          <input
            value={config.mcpServer}
            onChange={(event) => update({ mcpServer: event.target.value })}
          />
        </Field>
        <PathField
          label="MCP policy proxy script"
          value={config.mcpPolicyProxyScript}
          onChange={(mcpPolicyProxyScript) => update({ mcpPolicyProxyScript })}
          onChoose={() => void choosePath('mcpPolicyProxyScript', 'file')}
        />
        <PathField
          label="Browser policy manifest"
          value={config.mcpPolicyManifestPath}
          onChange={(mcpPolicyManifestPath) =>
            update({ mcpPolicyManifestPath })
          }
          onChoose={() => void choosePath('mcpPolicyManifestPath', 'file')}
        />
        <Field
          label="Allowed MCP tools"
          field="editor.computerUse.allowedTools"
          help="Shell, Node REPL, and web search remain disabled for this run. Configure the browser backend separately."
        >
          <textarea
            rows={5}
            value={config.allowedTools.join('\n')}
            onChange={(event) =>
              update({ allowedTools: lines(event.target.value) })
            }
          />
        </Field>
        <div className="computer-use-scope-grid">
          <Field
            label="MCP call budget"
            field="editor.computerUse.actionBudget"
            help="Enforced by the MCP proxy."
          >
            <input
              type="number"
              min={1}
              max={500}
              value={config.actionBudget}
              onChange={(event) =>
                update({ actionBudget: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Timeout (ms)" field="editor.computerUse.timeout">
            <input
              type="number"
              min={1}
              value={config.timeoutMs}
              onChange={(event) =>
                update({ timeoutMs: Number(event.target.value) })
              }
            />
          </Field>
        </div>
        <Field label="Model override" field="editor.computerUse.model">
          <input
            value={config.model ?? ''}
            placeholder="Use profile default"
            onChange={(event) => {
              const model = event.target.value;
              if (model) update({ model });
              else clearOptional('model');
            }}
          />
        </Field>
        <Field label="Reasoning effort" field="editor.computerUse.reasoning">
          <select
            value={config.reasoningEffort ?? ''}
            onChange={(event) => {
              const value = event.target.value as ComputerUseReasoningEffort;
              if (value) update({ reasoningEffort: value });
              else clearOptional('reasoningEffort');
            }}
          >
            <option value="">Profile default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
          </select>
        </Field>
      </section>

      <section className="inspector-section">
        <SectionHeading
          icon={<TerminalSquare size={13} />}
          label="Visible instruction"
        />
        <Field
          label="Exact instruction"
          field="editor.computerUse.instruction"
          help="Vorkflo adds no hidden prompt. The displayed scope and evidence paths are appended visibly."
        >
          <textarea
            rows={12}
            value={config.instruction}
            onChange={(event) => update({ instruction: event.target.value })}
          />
        </Field>
      </section>

      <section className="inspector-section">
        <SectionHeading
          icon={<FileText size={13} />}
          label="Declared outputs"
        />
        <p className="section-note">
          These paths are verified after the process succeeds. Vorkflo does not
          create their contents.
        </p>
        <PathField
          label="Working directory"
          value={config.workingDirectory ?? ''}
          onChange={(value) => {
            if (value) update({ workingDirectory: value });
            else clearOptional('workingDirectory');
          }}
          onChoose={() => void choosePath('workingDirectory', 'directory')}
        />
        <PathField
          label="Markdown report file"
          value={config.reportPath}
          onChange={(reportPath) => update({ reportPath })}
          onChoose={() => void choosePath('reportPath', 'output-file')}
        />
        <PathField
          label="Evidence screenshot"
          value={config.screenshotPath ?? ''}
          onChange={(value) => {
            if (value) update({ screenshotPath: value });
            else clearOptional('screenshotPath');
          }}
          onChoose={() => void choosePath('screenshotPath', 'output-file')}
        />
      </section>

      <section className="inspector-section invocation-section">
        <SectionHeading
          icon={<TerminalSquare size={13} />}
          label="Effective invocation"
        />
        <InvocationPreview block={block} />
      </section>
    </div>
  );
}

function SectionHeading({
  icon,
  label,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly children?: ReactNode;
}) {
  return (
    <header>
      <span className="section-heading">
        {icon}
        {label}
      </span>
      {children}
    </header>
  );
}

function Field({
  label,
  field,
  help,
  children,
}: {
  readonly label: string;
  readonly field?: string;
  readonly help?: string;
  readonly children: ReactNode;
}) {
  return (
    <label
      className="field"
      {...(field === undefined ? {} : { 'data-inspector-field': field })}
    >
      <span>{label}</span>
      {children}
      {help === undefined ? null : <small>{help}</small>}
    </label>
  );
}

function PathField({
  label,
  value,
  onChange,
  onChoose,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onChoose: () => void;
}) {
  return (
    <Field label={label}>
      <div className="path-field">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`Choose ${label.toLowerCase()}`}
          title={`Choose ${label.toLowerCase()}`}
          onClick={onChoose}
        >
          <FolderOpen size={14} />
        </button>
      </div>
    </Field>
  );
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
