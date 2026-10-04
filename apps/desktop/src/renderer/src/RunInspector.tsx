import { useEffect, useRef } from 'react';
import {
  type Artifact,
  type BlockPreflightPreview,
  type BlockExecutionState,
  type ExecutionFailure,
  type ProcessBlock,
  type WorkflowPreflightResult,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Copy,
  FileInput,
  FolderOpen,
  GitBranch,
  Info,
  LoaderCircle,
  Play,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import type { BlockRunSnapshot } from '../../shared/contracts';
import {
  getAgentBlockPresentation,
  withResolvedAgentWorkingDirectory,
  type AgentRuntimeId,
} from '../../shared/agent-runtime';
import { InvocationPreview } from './InvocationPreview';
import { PreflightPanel } from './PreflightPanel';
import { RunInputFields } from './WorkflowInputs';
import { DataSection, EmptyLine } from './InspectorPrimitives';

/** Run snapshots and authority review are read-only projections of engine state. */
export function RunInspector({
  snapshot,
  agentRuntime,
  onCopy,
  onReveal,
  onNavigateFailure,
}: {
  snapshot?: BlockRunSnapshot;
  agentRuntime?: AgentRuntimeId;
  onCopy: (value: string, label: string) => void;
  onReveal: (path: string) => void;
  onNavigateFailure: (failure: ExecutionFailure) => void;
}) {
  if (snapshot === undefined) {
    return (
      <div className="run-empty">
        <Clock3 size={22} />
        <strong>Not run yet</strong>
        <span>
          Run the workflow to inspect resolved inputs, output, and timing.
        </span>
      </div>
    );
  }
  const duration =
    snapshot.startedAt && snapshot.endedAt
      ? `${new Date(snapshot.endedAt).getTime() - new Date(snapshot.startedAt).getTime()} ms`
      : snapshot.startedAt
        ? 'Running…'
        : '—';
  return (
    <div className="inspector-scroll run-details">
      <div className={`run-state-card ${snapshot.state}`}>
        {stateIcon(snapshot.state)}
        <div>
          <small>BLOCK STATE</small>
          <strong>{snapshot.state}</strong>
        </div>
        <span>{duration}</span>
      </div>
      {snapshot.failure && (
        <div className="failure-card">
          <XCircle size={16} />
          <div>
            <strong>{snapshot.failure.code}</strong>
            <p>{snapshot.failure.message}</p>
            {snapshot.failure.nextAction && (
              <small>{snapshot.failure.nextAction}</small>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Copy failure details"
            onClick={() =>
              onCopy(
                [
                  snapshot.failure!.code,
                  snapshot.failure!.message,
                  snapshot.failure!.nextAction ?? '',
                ]
                  .filter(Boolean)
                  .join('\n'),
                'Failure details',
              )
            }
          >
            <Copy size={13} />
          </button>
          <button
            className="icon-button"
            aria-label="Review responsible setting"
            title="Open the most relevant configuration field"
            onClick={() => onNavigateFailure(snapshot.failure!)}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      {snapshot.skipReason && (
        <div className="failure-card muted">
          <Info size={16} />
          <p>{snapshot.skipReason}</p>
        </div>
      )}
      <DataSection
        title="Resolved inputs"
        count={Object.keys(snapshot.inputs).length}
      >
        {Object.entries(snapshot.inputs).map(([portId, artifact]) => (
          <ArtifactView
            key={portId}
            label={portId}
            artifact={artifact}
            onCopy={onCopy}
            onReveal={onReveal}
          />
        ))}
        {Object.keys(snapshot.inputs).length === 0 && (
          <EmptyLine text="No inputs" />
        )}
      </DataSection>
      <DataSection title="Produced artifacts" count={snapshot.artifacts.length}>
        {snapshot.artifacts.map((artifact) => (
          <ArtifactView
            key={artifact.id}
            label={
              'portId' in artifact.provenance
                ? artifact.provenance.portId
                : artifact.provenance.inputId
            }
            artifact={artifact}
            onCopy={onCopy}
            onReveal={onReveal}
          />
        ))}
        {snapshot.artifacts.length === 0 && <EmptyLine text="No artifacts" />}
      </DataSection>
      <DataSection
        title="stdout"
        action={
          <button
            className="icon-button"
            aria-label="Copy stdout"
            onClick={() => onCopy(snapshot.stdout, 'stdout')}
          >
            <Copy size={13} />
          </button>
        }
      >
        <pre>{snapshot.stdout || 'No stdout captured.'}</pre>
      </DataSection>
      {agentRuntime === 'codex' && snapshot.stderr && (
        <p className="stream-note">
          Codex writes progress and session metadata to stderr. It is shown as
          session output here; the block state and failure details identify
          actual run failures.
        </p>
      )}
      <DataSection
        title={agentRuntime === 'codex' ? 'Session output (stderr)' : 'stderr'}
        action={
          <button
            className="icon-button"
            aria-label={
              agentRuntime === 'codex' ? 'Copy session output' : 'Copy stderr'
            }
            onClick={() =>
              onCopy(
                snapshot.stderr,
                agentRuntime === 'codex' ? 'Session output' : 'stderr',
              )
            }
          >
            <Copy size={13} />
          </button>
        }
      >
        <pre
          className={
            snapshot.stderr && agentRuntime !== 'codex' ? 'error-output' : ''
          }
        >
          {snapshot.stderr ||
            (agentRuntime === 'codex'
              ? 'No session output captured.'
              : 'No stderr captured.')}
        </pre>
      </DataSection>
      <DataSection title="Process result">
        <dl className="result-grid">
          <dt>Exit code</dt>
          <dd>{snapshot.exitCode ?? '—'}</dd>
          <dt>Started</dt>
          <dd>{formatTime(snapshot.startedAt)}</dd>
          <dt>Ended</dt>
          <dd>{formatTime(snapshot.endedAt)}</dd>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </dl>
      </DataSection>
    </div>
  );
}

export function RunPreview({
  starting = false,
  workflow,
  valid,
  inputValues,
  inputErrors,
  onInputChange,
  selectPath,
  preflight,
  preflightLoading,
  onSelectIssue,
  trustConfirmed,
  onTrustChange,
  onClose,
  onRun,
}: {
  starting?: boolean;
  workflow: WorkflowDefinition;
  valid: boolean;
  inputValues: Readonly<Record<string, string>>;
  inputErrors: Readonly<Record<string, string>>;
  onInputChange: (inputId: string, value: string) => void;
  selectPath: (
    kind: 'file' | 'directory' | 'output-file',
    defaultPath?: string,
  ) => Promise<string | undefined>;
  preflight?: WorkflowPreflightResult;
  preflightLoading: boolean;
  onSelectIssue: (blockId: string | undefined, field: string) => void;
  trustConfirmed: boolean;
  onTrustChange: (checked: boolean) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="run-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review workflow authority"
      >
        <header>
          <div className="modal-icon">
            <ShieldAlert size={20} />
          </div>
          <div>
            <small>AUTHORITY REVIEW</small>
            <h2>Review before running</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            aria-label="Close run review"
            disabled={starting}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="run-modal-body">
          <div className="trust-banner">
            <AlertTriangle size={18} />
            <div>
              <strong>This workflow is executable code.</strong>
              <p>
                Processes run locally with your user permissions. Shell blocks
                can interpret expansion, pipes, redirects, and other shell
                syntax. Output may contain sensitive data.
              </p>
            </div>
          </div>
          <div className="preview-meta">
            <span>
              <GitBranch size={14} /> {workflow.blocks.length} processes
            </span>
            <span>
              <FileInput size={14} /> {workflow.connections.length} artifact
              routes
            </span>
            <span>
              <Check size={14} /> Manual run
            </span>
          </div>
          <RunInputFields
            workflow={workflow}
            values={inputValues}
            errors={inputErrors}
            onChange={onInputChange}
            selectPath={selectPath}
          />
          <PreflightPanel
            {...(preflight === undefined ? {} : { result: preflight })}
            loading={preflightLoading}
            onSelectIssue={onSelectIssue}
          />
          <div className="command-preview">
            {workflow.blocks.map((block, index) => (
              <article
                key={block.id}
                className={block.invocation.shell ? 'uses-shell' : ''}
              >
                <span className="preview-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{block.name}</strong>
                  <RunInvocationPreview
                    workflow={workflow}
                    block={block}
                    {...(preflight?.blocks.find(
                      (preview) => preview.blockId === block.id,
                    ) === undefined
                      ? {}
                      : {
                          resolved: preflight.blocks.find(
                            (preview) => preview.blockId === block.id,
                          )!,
                        })}
                  />
                  <AgentIsolationPreview
                    workflow={workflow}
                    blockId={block.id}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
        <label className="consent-row">
          <input
            type="checkbox"
            checked={trustConfirmed}
            onChange={(event) => onTrustChange(event.target.checked)}
          />
          <span className="custom-check">
            <Check size={13} />
          </span>
          <span>
            I reviewed the commands and trust this workflow to run on my
            computer.
          </span>
        </label>
        <footer>
          <button className="button" disabled={starting} onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!valid || !trustConfirmed || preflightLoading || starting}
            onClick={onRun}
          >
            {starting ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
            {starting ? 'Starting workflow…' : 'Run workflow'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RunInvocationPreview({
  workflow,
  block,
  resolved,
}: {
  workflow: WorkflowDefinition;
  block: ProcessBlock;
  resolved?: BlockPreflightPreview;
}) {
  const workingDirectory =
    resolved?.workingDirectory ?? block.invocation.workingDirectory;
  const effectiveBlock =
    workingDirectory === undefined
      ? block
      : withResolvedAgentWorkingDirectory(
          block,
          getAgentBlockPresentation(workflow, block.id),
          workingDirectory,
        );
  return (
    <InvocationPreview
      block={effectiveBlock}
      {...(resolved === undefined ? {} : { resolved })}
    />
  );
}

function AgentIsolationPreview({
  workflow,
  blockId,
}: {
  workflow: WorkflowDefinition;
  blockId: string;
}) {
  const presentation = getAgentBlockPresentation(workflow, blockId);
  const isolation = presentation?.isolation;
  if (isolation?.mode !== 'workflow-run-worktree') return null;
  return (
    <div className="isolation-preview">
      <GitBranch size={12} />
      <span>
        <strong>Workflow-run worktree · {isolation.scope}</strong>
        <small>
          {isolation.repositoryRoot} @ {isolation.baseRef}
        </small>
        <small>
          A run-scoped branch and worktree will be created before this process
          starts. Vorkflo will not commit, merge, push, or discard changes.
        </small>
      </span>
    </div>
  );
}

function ArtifactView({
  label,
  artifact,
  onCopy,
  onReveal,
}: {
  label: string;
  artifact: Artifact;
  onCopy?: (value: string, label: string) => void;
  onReveal?: (path: string) => void;
}) {
  const value =
    artifact.kind === 'filesystem-reference'
      ? artifact.path
      : artifact.kind === 'json'
        ? JSON.stringify(artifact.value, null, 2)
        : artifact.value;
  return (
    <div className="artifact-view">
      <div>
        <Braces size={13} />
        <strong>{label}</strong>
        <small className="artifact-provenance">
          {artifactProvenanceLabel(artifact)}
        </small>
        <span>{artifact.kind}</span>
        {onCopy !== undefined && (
          <button
            className="icon-button"
            aria-label={`Copy ${label}`}
            onClick={() => onCopy(value, label)}
          >
            <Copy size={12} />
          </button>
        )}
        {artifact.kind === 'filesystem-reference' && onReveal !== undefined && (
          <button
            className="icon-button"
            aria-label={`Reveal ${label} in Finder`}
            onClick={() => onReveal(artifact.path)}
          >
            <FolderOpen size={12} />
          </button>
        )}
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function artifactProvenanceLabel(artifact: Artifact): string {
  if ('source' in artifact.provenance) {
    return `workflow input · ${artifact.provenance.valueSource}`;
  }
  return `block output · ${artifact.provenance.blockId}`;
}

function formatTime(value?: string): string {
  return value === undefined
    ? '—'
    : new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }).format(new Date(value));
}

function stateIcon(state: BlockExecutionState): React.ReactNode {
  if (state === 'running') return <LoaderCircle size={19} className="spin" />;
  if (state === 'succeeded') return <Check size={19} />;
  if (state === 'failed') return <XCircle size={19} />;
  if (state === 'cancelled') return <CircleStop size={19} />;
  return <Clock3 size={19} />;
}
