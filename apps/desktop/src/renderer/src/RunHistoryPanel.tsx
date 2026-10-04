import type { RunHistoryRecord } from '../../shared/contracts';
import { useState } from 'react';
import {
  Clock3,
  FileDiff,
  FolderOpen,
  GitBranch,
  Sparkles,
  Trash2,
} from 'lucide-react';

export function RunHistoryPanel({
  records,
  selectedRunId,
  onSelect,
  onClear,
  onReveal,
  onWorktreeChanged,
  disabled = false,
}: {
  records: readonly RunHistoryRecord[];
  selectedRunId?: string;
  onSelect: (record: RunHistoryRecord) => void;
  onClear: () => void;
  onReveal?: (path: string) => void;
  onWorktreeChanged?: () => void;
  disabled?: boolean;
}) {
  const selected = records.find((record) => record.runId === selectedRunId);
  const [inspection, setInspection] = useState<{
    readonly runId: string;
    readonly scopeId: string;
    readonly text: string;
  }>();
  const [worktreeError, setWorktreeError] = useState<{
    runId: string;
    message: string;
  }>();
  return (
    <section className="run-history-panel" aria-label="Local run history">
      <header>
        <div>
          <small>LOCAL HISTORY</small>
          <strong>Previous runs</strong>
        </div>
        <button
          className="icon-button"
          aria-label="Clear workflow run history"
          disabled={disabled || records.length === 0}
          onClick={onClear}
        >
          <Trash2 size={13} />
        </button>
      </header>
      <details className="history-policy">
        <summary>Stored on this Mac · Output may be sensitive</summary>
        <p>
          Retained locally for up to 30 days within the 100 MiB application
          limit. Output and paths may be sensitive. Records that own retained
          worktrees remain until those scopes are safely cleaned.
        </p>
      </details>
      <div className="run-history-list">
        {records.map((record) => (
          <button
            key={record.runId}
            className={record.runId === selectedRunId ? 'selected' : ''}
            aria-pressed={record.runId === selectedRunId}
            disabled={disabled}
            onClick={() => onSelect(record)}
          >
            <Clock3 size={13} />
            <span>
              <strong>{record.outcome}</strong>
              <small>{new Date(record.completedAt).toLocaleString()}</small>
            </span>
            <em>
              {record.blocks.filter((block) => block.state === 'failed').length}{' '}
              failed
            </em>
          </button>
        ))}
        {records.length === 0 && (
          <div className="empty-line">No retained runs for this workflow</div>
        )}
      </div>
      {(selected?.worktrees?.length ?? 0) > 0 && (
        <div className="run-history-worktrees">
          <small>WORKTREE SCOPES</small>
          {selected!.worktrees!.map((worktree) => (
            <article key={worktree.scopeId}>
              <GitBranch size={13} />
              <span>
                <strong>
                  {worktree.scopeId} · {worktree.state}
                </strong>
                <small>{worktree.worktreePath}</small>
                <small>
                  {worktree.branchName} · base{' '}
                  {worktree.baseCommit.slice(0, 12)}
                </small>
                <small>
                  Source {worktree.sourceIsDirty ? 'was dirty' : 'was clean'} ·{' '}
                  {worktree.hasChangesFromBase
                    ? 'scope changed'
                    : 'scope unchanged'}
                </small>
                {worktree.status !== '' && <small>{worktree.status}</small>}
                <small>{worktree.nextAction}</small>
              </span>
              {worktree.state === 'retained' && onReveal !== undefined && (
                <span className="worktree-actions">
                  <button
                    className="icon-button"
                    aria-label={`Inspect retained worktree ${worktree.scopeId}`}
                    disabled={disabled}
                    onClick={() => {
                      setWorktreeError(undefined);
                      void window.vorkflo
                        .inspectRunWorktree(selected!.runId, worktree.scopeId)
                        .then((result) =>
                          setInspection({
                            runId: selected!.runId,
                            scopeId: worktree.scopeId,
                            text:
                              result.diff ||
                              result.status ||
                              'Worktree is clean.',
                          }),
                        )
                        .catch((error: unknown) =>
                          setWorktreeError({
                            runId: selected!.runId,
                            message:
                              error instanceof Error
                                ? error.message
                                : String(error),
                          }),
                        );
                    }}
                  >
                    <FileDiff size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Reveal retained worktree ${worktree.scopeId}`}
                    onClick={() => onReveal(worktree.worktreePath)}
                  >
                    <FolderOpen size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Safely clean worktree ${worktree.scopeId}`}
                    disabled={disabled}
                    onClick={() => {
                      setWorktreeError(undefined);
                      void window.vorkflo
                        .cleanupRunWorktree(selected!.runId, worktree.scopeId)
                        .then(() => {
                          setInspection(undefined);
                          onWorktreeChanged?.();
                        })
                        .catch((error: unknown) =>
                          setWorktreeError({
                            runId: selected!.runId,
                            message:
                              error instanceof Error
                                ? error.message
                                : String(error),
                          }),
                        );
                    }}
                  >
                    <Sparkles size={12} />
                  </button>
                </span>
              )}
              {inspection?.runId === selected!.runId &&
                inspection.scopeId === worktree.scopeId && (
                  <pre>{inspection.text}</pre>
                )}
            </article>
          ))}
          {worktreeError?.runId === selected!.runId && (
            <p className="worktree-error" role="alert">
              {worktreeError.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
