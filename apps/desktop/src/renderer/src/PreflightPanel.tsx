import type { WorkflowPreflightResult } from '@vorkflo/engine';
import { AlertTriangle, Check, LoaderCircle, XCircle } from 'lucide-react';

export function PreflightPanel({
  result,
  loading,
  onSelectIssue,
}: {
  result?: WorkflowPreflightResult;
  loading: boolean;
  onSelectIssue: (blockId: string | undefined, field: string) => void;
}) {
  if (loading) {
    return (
      <section className="preflight-panel loading" aria-live="polite">
        <LoaderCircle className="spin" size={15} />
        <span>Checking local requirements without launching tools…</span>
      </section>
    );
  }
  if (result === undefined) return null;
  const blockers = result.issues.filter(
    (issue) => issue.severity === 'blocker',
  );
  const warnings = result.issues.filter(
    (issue) => issue.severity === 'warning',
  );
  return (
    <section
      className={`preflight-panel ${result.ready ? 'ready' : 'blocked'}`}
      aria-label="Workflow preflight"
      aria-live="polite"
    >
      <header>
        {result.ready ? <Check size={15} /> : <XCircle size={15} />}
        <div>
          <strong>
            {result.ready ? 'Preflight passed' : 'Preflight blocked'}
          </strong>
          <small>
            {blockers.length} blockers · {warnings.length} warnings · no tools
            launched
          </small>
        </div>
      </header>
      <div className="preflight-issues">
        {result.issues.map((issue, index) => (
          <button
            key={`${issue.code}:${issue.path}:${index}`}
            className={issue.severity}
            onClick={() => onSelectIssue(issue.blockId, issue.field)}
          >
            {issue.severity === 'blocker' ? (
              <XCircle size={13} />
            ) : (
              <AlertTriangle size={13} />
            )}
            <span>
              <strong>{issue.message}</strong>
              <small>
                {issue.code} · {issue.field}
              </small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
