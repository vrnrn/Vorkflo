import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunHistoryPanel } from '../src/renderer/src/RunHistoryPanel';
import type { RunHistoryRecord } from '../src/shared/contracts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps a delayed worktree inspection attached to its run', async () => {
  let finish!: (result: { diff: string; status: string }) => void;
  vi.stubGlobal('vorkflo', {
    inspectRunWorktree: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  });
  const props = {
    records: [record('first'), record('second')],
    onSelect: vi.fn(),
    onClear: vi.fn(),
    onReveal: vi.fn(),
  };
  const { getByLabelText, queryByText, rerender } = render(
    <RunHistoryPanel {...props} selectedRunId="first" />,
  );
  fireEvent.click(getByLabelText('Inspect retained worktree shared'));
  rerender(<RunHistoryPanel {...props} selectedRunId="second" />);
  await act(async () => finish({ diff: 'First run diff', status: '' }));
  expect(queryByText('First run diff')).not.toBeInTheDocument();
  rerender(<RunHistoryPanel {...props} selectedRunId="first" />);
  expect(queryByText('First run diff')).toBeInTheDocument();
  rerender(<RunHistoryPanel {...props} selectedRunId="first" disabled />);
  expect(getByLabelText('Inspect retained worktree shared')).toBeDisabled();
  expect(getByLabelText('Safely clean worktree shared')).toBeDisabled();
  expect(getByLabelText('Clear workflow run history')).toBeDisabled();
});

function record(runId: string): RunHistoryRecord {
  return {
    schemaVersion: 1,
    runId,
    workflowId: 'workflow',
    workflowName: 'Workflow',
    startedAt: '2026-07-09T12:00:00Z',
    completedAt: '2026-07-09T12:01:00Z',
    outcome: 'succeeded',
    blocks: [],
    runInputs: {},
    worktrees: [
      {
        scopeId: 'shared',
        repositoryRoot: '/tmp/repository',
        baseCommit: 'base',
        branchName: `vorkflo/${runId}`,
        worktreePath: `/tmp/${runId}`,
        createdAt: '2026-07-09T12:00:00Z',
        sourceIsDirty: false,
        state: 'retained',
        reason: 'scope-changed',
        status: '',
        headCommit: 'head',
        hasChangesFromBase: true,
        nextAction: 'Inspect the diff.',
      },
    ],
  };
}
