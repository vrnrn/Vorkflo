import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, runtimeFailureInspectorField } from '../src/renderer/src/App';
import {
  compileAgentBlock,
  setAgentBlockPresentation,
} from '../src/shared/agent-runtime';
import {
  readWorkflowDraft,
  writeWorkflowDraft,
  type DraftStorage,
} from '../src/renderer/src/draft-store';
import { createWorkflow } from '../src/shared/defaults';
import type {
  DesktopRunEvent,
  RunHistoryRecord,
} from '../src/shared/contracts';

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

class TestDraftStorage implements DraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

describe('block configuration ordering', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: new TestDraftStorage(),
    });
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(window, 'vorkflo', {
      configurable: true,
      value: {
        getUserModelCatalog: vi.fn().mockResolvedValue({
          filePath: '/home/test/.vorkflo/models.json',
          catalog: {
            schemaVersion: 1,
            codex: { models: [] },
            cline: { models: [] },
            agy: { models: [] },
          },
        }),

        openWorkflow: vi.fn(),
        saveWorkflow: vi.fn().mockResolvedValue({
          canceled: false,
          filePath: '/tmp/workflow.vorkflo.json',
        }),
        selectFilesystemPath: vi.fn(),
        openFilesystemPath: vi.fn().mockResolvedValue(undefined),
        revealFilesystemPath: vi.fn(),
        listRunHistory: vi.fn().mockResolvedValue([]),
        clearRunHistory: vi.fn().mockResolvedValue(undefined),
        preflightWorkflow: vi.fn().mockResolvedValue({
          ready: true,
          issues: [],
          blocks: [],
        }),
        runWorkflow: vi.fn(),
        cancelRun: vi.fn(),
        onRunEvent: vi.fn(() => () => undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reorders literal and input-bound arguments from their drag handles', () => {
    const { container, getByText } = render(<App />);
    const argumentsSection = getByText('Arguments').closest('section');
    const inputPortsSection = getByText('Input ports').closest('section');
    expect(argumentsSection).not.toBeNull();
    expect(inputPortsSection).not.toBeNull();

    fireEvent.click(
      within(argumentsSection!).getByRole('button', { name: 'Add' }),
    );
    fireEvent.change(within(argumentsSection!).getByLabelText('Argument 2'), {
      target: { value: 'second' },
    });

    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    };
    const firstHandle = within(argumentsSection!).getByRole('button', {
      name: 'Reorder argument 1',
    });
    const secondRow = within(argumentsSection!)
      .getByLabelText('Argument 2')
      .closest('.argument-row');
    expect(secondRow).not.toBeNull();

    fireEvent.dragStart(firstHandle, { dataTransfer });
    fireEvent.dragEnter(secondRow!, { dataTransfer });
    fireEvent.dragOver(secondRow!, { dataTransfer });
    fireEvent.drop(secondRow!, { dataTransfer });

    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>('.argument-row input'),
      ].map((input) => input.value),
    ).toEqual(['second', 'Hello from Vorkflo\\n']);

    fireEvent.click(
      within(inputPortsSection!).getByRole('button', { name: 'Add' }),
    );
    const inputArgumentHandle = within(argumentsSection!).getByRole('button', {
      name: 'Reorder input argument input-1',
    });
    fireEvent.keyDown(inputArgumentHandle, { key: 'ArrowUp' });
    fireEvent.keyDown(inputArgumentHandle, { key: 'ArrowUp' });

    expect(container.querySelector('.argument-row')?.textContent).toContain(
      'input:input-1',
    );
  });

  it('undoes and redoes workflow edits from toolbar and keyboard controls', async () => {
    const { getByLabelText, getByRole } = render(<App />);
    const name = getByLabelText('Workflow name');
    const undo = getByRole('button', { name: 'Undo' });
    const redo = getByRole('button', { name: 'Redo' });

    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Edited workflow' } });
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(name).toHaveValue('Untitled workflow');
    expect(redo).toBeEnabled();
    await waitFor(() =>
      expect(readWorkflowDraft(window.localStorage)).toBeUndefined(),
    );

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(name).toHaveValue('Edited workflow');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(name).toHaveValue('Untitled workflow');
  });

  it('copies and pastes selected blocks with fresh IDs', () => {
    const { container, getByLabelText } = render(<App />);
    const copy = getByLabelText('Copy block');
    const paste = getByLabelText('Paste block');
    const workflowName = getByLabelText('Workflow name');

    expect(paste).toBeDisabled();
    expect(fireEvent.keyDown(workflowName, { key: 'c', metaKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(workflowName, { key: 'v', metaKey: true })).toBe(
      true,
    );
    expect(paste).toBeDisabled();

    fireEvent.click(copy);
    expect(getByLabelText('Paste block')).toBeEnabled();
    fireEvent.click(getByLabelText('Paste block'));
    fireEvent.click(getByLabelText('Paste block'));

    const ids = [
      ...container.querySelectorAll<HTMLElement>('.react-flow__node'),
    ].map((node) => node.dataset.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('supports non-editable keyboard copy and paste shortcuts', () => {
    const { container, getByLabelText } = render(<App />);

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(getByLabelText('Paste block')).toBeEnabled();
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2);
  });

  it('auto-arranges only after the explicit accessible action', async () => {
    const { getByLabelText, getByRole } = render(<App />);
    fireEvent.click(getByRole('button', { name: 'Add process' }));
    fireEvent.click(getByRole('button', { name: 'Add process' }));
    fireEvent.click(getByLabelText('Auto arrange'));

    await waitFor(() => {
      const positions = Object.values(
        readWorkflowDraft(window.localStorage)?.workflow.layout
          ?.blockPositions ?? {},
      );
      expect(positions).toEqual([
        { x: 160, y: 140 },
        { x: 160, y: 380 },
        { x: 160, y: 620 },
      ]);
    });
  });

  it('preserves mounted node content during edits, copying, and auto-arrange', () => {
    const { container, getByLabelText } = render(<App />);
    const node = container.querySelector('.process-node');
    expect(node).not.toBeNull();

    fireEvent.change(getByLabelText('Workflow name'), {
      target: { value: 'Renamed workflow' },
    });
    expect(container.querySelector('.process-node')).toBe(node);

    fireEvent.click(getByLabelText('Copy block'));
    expect(getByLabelText('Paste block')).toBeEnabled();
    expect(container.querySelector('.process-node')).toBe(node);

    fireEvent.click(getByLabelText('Auto arrange'));
    expect(container.querySelector('.process-node')).toBe(node);
  });

  it('recovers a valid draft and clears and rebases it after save', async () => {
    const recovered = { ...createWorkflow(), name: 'Recovered workflow' };
    expect(
      writeWorkflowDraft(
        {
          workflow: recovered,
          filePath: '/tmp/recovered.vorkflo.json',
        },
        window.localStorage,
      ),
    ).toBe(true);

    const { getByLabelText, getByText } = render(<App />);
    const name = getByLabelText('Workflow name');
    expect(name).toHaveValue('Recovered workflow');
    expect(getByText('Recovered unsaved draft.')).toBeInTheDocument();

    fireEvent.change(name, { target: { value: 'Saved recovery' } });
    expect(getByLabelText('Undo')).toBeEnabled();
    fireEvent.click(getByLabelText('Save'));

    await waitFor(() => {
      expect(window.vorkflo.saveWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/tmp/recovered.vorkflo.json',
          workflow: expect.objectContaining({ name: 'Saved recovery' }),
        }),
      );
      expect(readWorkflowDraft(window.localStorage)).toBeUndefined();
      expect(getByLabelText('Undo')).toBeDisabled();
    });
  });

  it('clears draft history when opening or creating a workflow', async () => {
    const opened = { ...createWorkflow(), name: 'Opened workflow' };
    vi.mocked(window.vorkflo.openWorkflow).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/opened.vorkflo.json',
      workflow: opened,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { getByLabelText } = render(<App />);
    const name = getByLabelText('Workflow name');

    fireEvent.change(name, { target: { value: 'Discard this edit' } });
    fireEvent.click(getByLabelText('Open'));
    await waitFor(() => {
      expect(name).toHaveValue('Opened workflow');
      expect(getByLabelText('Undo')).toBeDisabled();
      expect(readWorkflowDraft(window.localStorage)).toBeUndefined();
    });

    fireEvent.change(name, { target: { value: 'Discard another edit' } });
    fireEvent.click(getByLabelText('New'));
    await waitFor(() => {
      expect(name).toHaveValue('Untitled workflow');
      expect(getByLabelText('Undo')).toBeDisabled();
      expect(readWorkflowDraft(window.localStorage)).toBeUndefined();
    });
  });

  it('exposes the AI Agent editor and compiles visible Codex authority', async () => {
    const { getByLabelText, getByRole } = render(<App />);

    fireEvent.click(getByRole('button', { name: 'Add AI Agent' }));
    const instruction = getByLabelText('Agent instruction');
    const authority = getByLabelText('Agent authority');
    expect(getByRole('combobox', { name: 'Agent runtime' })).toHaveValue(
      'codex',
    );

    fireEvent.change(instruction, {
      target: { value: 'Create release-notes.md.' },
    });
    fireEvent.change(authority, { target: { value: 'workspace-write' } });

    const preview = getByRole('region', { name: 'Exact invocation preview' });
    expect(preview).toHaveTextContent('workspace-write');
    expect(preview).toHaveTextContent('Create release-notes.md.');
    expect(preview).toHaveTextContent('DIRECT');
    expect(preview).not.toHaveTextContent('SHELL');
  });

  it('prompts for a reusable workflow input and sends its typed run value', async () => {
    const opened = createWorkflow();
    const block = {
      ...opened.blocks[0]!,
      inputs: [
        {
          id: 'message',
          name: 'Message',
          artifactKind: 'text' as const,
          required: true,
        },
      ],
      invocation: {
        ...opened.blocks[0]!.invocation,
        arguments: [{ type: 'input' as const, portId: 'message' }],
      },
    };
    const workflow = {
      ...opened,
      inputs: [
        {
          id: 'prompt',
          name: 'Prompt',
          artifactKind: 'text' as const,
          required: true,
        },
      ],
      inputBindings: [
        {
          id: 'prompt-binding',
          inputId: 'prompt',
          to: { blockId: block.id, portId: 'message' },
        },
      ],
      blocks: [block],
    };
    vi.mocked(window.vorkflo.openWorkflow).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/parameterized.vorkflo.json',
      workflow,
    });
    vi.mocked(window.vorkflo.runWorkflow).mockResolvedValue({
      runId: 'run-parameterized',
    });

    const { getByLabelText, getByRole } = render(<App />);
    fireEvent.click(getByLabelText('Open'));
    await waitFor(() =>
      expect(getByLabelText('Workflow name')).toHaveValue(workflow.name),
    );
    fireEvent.click(getByRole('button', { name: 'Review & Run' }));
    const value = getByRole('textbox', { name: 'Prompt (text)' });
    fireEvent.change(value, { target: { value: 'first run value' } });
    fireEvent.click(
      getByRole('checkbox', {
        name: /I reviewed the commands and trust this workflow/,
      }),
    );
    fireEvent.click(getByRole('button', { name: 'Run workflow' }));

    await waitFor(() =>
      expect(window.vorkflo.runWorkflow).toHaveBeenCalledWith({
        runId: expect.any(String),
        workflow,
        workflowFilePath: '/tmp/parameterized.vorkflo.json',
        runInputs: {
          prompt: { kind: 'text', value: 'first run value' },
        },
      }),
    );
  });

  it('restores retained failed-run evidence and clears local history', async () => {
    vi.mocked(window.vorkflo.listRunHistory).mockResolvedValue([
      {
        schemaVersion: 1,
        runId: 'retained-run',
        workflowId: 'any-workflow',
        workflowName: 'Retained workflow',
        startedAt: '2026-07-09T01:00:00.000Z',
        completedAt: '2026-07-09T01:00:01.000Z',
        outcome: 'failed',
        runInputs: {},
        blocks: [
          {
            blockId: 'welcome',
            state: 'failed',
            inputs: {},
            artifacts: [],
            stdout: 'before failure',
            stderr: 'authentication failed',
            exitCode: 1,
            failure: {
              code: 'process_exit_nonzero',
              message: 'The process exited with code 1.',
              nextAction: 'Inspect stderr.',
            },
          },
        ],
      },
    ]);

    const { getByLabelText, getByRole, getByText } = render(<App />);
    const retained = await waitFor(() =>
      within(getByRole('region', { name: 'Local run history' })).getByRole(
        'button',
        { name: /failed.*failed/i },
      ),
    );
    fireEvent.click(retained);
    expect(getByText('process_exit_nonzero')).toBeInTheDocument();
    expect(getByText('authentication failed')).toBeInTheDocument();
    expect(getByRole('tab', { name: /Run details/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(getByLabelText('Clear workflow run history'));
    await waitFor(() =>
      expect(window.vorkflo.clearRunHistory).toHaveBeenCalled(),
    );
    expect(getByText('No retained runs for this workflow')).toBeInTheDocument();
  });

  it('presents Codex stderr as neutral session output', async () => {
    const base = createWorkflow();
    const agent = compileAgentBlock({
      id: 'codex-agent',
      name: 'Codex Agent',
      agentRuntime: 'codex',
      instruction: 'Return a concise response.',
      authority: 'read-only',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
    });
    const workflow = setAgentBlockPresentation(
      { ...base, blocks: [agent], connections: [] },
      agent.id,
      'codex',
    );
    vi.mocked(window.vorkflo.openWorkflow).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/codex.vorkflo.json',
      workflow,
    });
    vi.mocked(window.vorkflo.listRunHistory).mockResolvedValue([
      {
        schemaVersion: 1,
        runId: 'codex-run',
        workflowId: workflow.id,
        workflowName: workflow.name,
        startedAt: '2026-07-10T01:00:00.000Z',
        completedAt: '2026-07-10T01:00:01.000Z',
        outcome: 'succeeded',
        runInputs: {},
        blocks: [
          {
            blockId: agent.id,
            state: 'succeeded',
            inputs: {},
            artifacts: [],
            stdout: 'final response',
            stderr: 'OpenAI Codex v0.144.1\n',
            exitCode: 0,
          },
        ],
      },
    ]);

    const { getByLabelText, getByRole, getByText } = render(<App />);
    fireEvent.click(getByLabelText('Open'));
    const history = await waitFor(() =>
      getByRole('region', { name: 'Local run history' }),
    );
    fireEvent.click(
      await waitFor(() =>
        within(history).getByRole('button', { name: /succeeded.*0 failed/i }),
      ),
    );
    fireEvent.click(getByRole('tab', { name: /Run details/ }));

    expect(getByText('Session output (stderr)')).toBeInTheDocument();
    expect(getByLabelText('Copy session output')).toBeInTheDocument();
    expect(getByText('OpenAI Codex v0.144.1')).not.toHaveClass('error-output');
  });

  it('supports keyboard tab navigation and traps focus in run review', async () => {
    const { getByRole, queryByRole } = render(<App />);
    const configure = getByRole('tab', { name: 'Configure' });
    const run = getByRole('tab', { name: /Run details/ });

    configure.focus();
    fireEvent.keyDown(configure, { key: 'ArrowRight' });
    await waitFor(() => expect(run).toHaveFocus());
    expect(run).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'inspector-run-tab',
    );

    fireEvent.click(getByRole('button', { name: 'Review & Run' }));
    const dialog = getByRole('dialog', {
      name: 'Review workflow authority',
    });
    const close = getByRole('button', { name: 'Close run review' });
    await waitFor(() => expect(close).toHaveFocus());
    const cancel = getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates from a preflight blocker to its responsible field', async () => {
    vi.mocked(window.vorkflo.preflightWorkflow).mockResolvedValue({
      ready: false,
      blocks: [],
      issues: [
        {
          severity: 'blocker',
          code: 'adapter_executable_missing',
          message: 'Executable is unavailable.',
          path: 'blocks[0].invocation.executable',
          field: 'invocation.executable',
          blockId: 'welcome',
        },
      ],
    });
    const { container, getByRole, getByText, queryByRole } = render(<App />);

    fireEvent.click(getByRole('button', { name: 'Review & Run' }));
    const blocker = await waitFor(() =>
      getByRole('button', { name: /Executable is unavailable/ }),
    );
    fireEvent.click(blocker);

    expect(queryByRole('dialog')).not.toBeInTheDocument();
    expect(getByText('Review invocation.executable.')).toBeInTheDocument();
    const executable = container.querySelector<HTMLElement>(
      '[data-inspector-field="invocation.executable"]',
    );
    await waitFor(() => expect(executable).toHaveFocus());
  });

  it('keeps run-input blockers in the review and focuses the missing value', async () => {
    vi.mocked(window.vorkflo.preflightWorkflow).mockResolvedValue({
      ready: false,
      blocks: [],
      issues: [
        {
          severity: 'blocker',
          code: 'missing_required_run_input',
          message: 'Required workflow input "input-1" is missing.',
          path: 'runInputs.input-1',
          field: 'runInputs.input-1',
        },
      ],
    });
    const { getAllByRole, getByRole } = render(<App />);
    const inputsPanel = getByRole('region', { name: 'Workflow inputs' });
    fireEvent.click(within(inputsPanel).getByRole('button', { name: 'Add' }));
    fireEvent.click(getByRole('button', { name: 'Review & Run' }));

    const issue = await waitFor(() =>
      getByRole('button', { name: /Required workflow input/ }),
    );
    fireEvent.click(issue);
    expect(
      getByRole('dialog', { name: 'Review workflow authority' }),
    ).toBeInTheDocument();
    const value = getAllByRole('textbox', { name: 'input-1 (text)' })[0];
    await waitFor(() => expect(value).toHaveFocus());
  });

  it('navigates from a typed runtime failure to its responsible field', async () => {
    let onRunEvent: ((event: DesktopRunEvent) => void) | undefined;
    vi.mocked(window.vorkflo.onRunEvent).mockImplementation((listener) => {
      onRunEvent = listener;
      return () => undefined;
    });
    const { container, getByRole } = render(<App />);

    act(() => {
      onRunEvent?.({
        type: 'run_started',
        runId: 'runtime-navigation',
        startedAt: '2026-07-09T12:00:00.000Z',
        blocks: [failedSnapshot('executable_not_found')],
      });
    });
    fireEvent.click(getByRole('tab', { name: /Run details/ }));
    fireEvent.click(
      getByRole('button', { name: 'Review responsible setting' }),
    );

    expect(getByRole('tab', { name: 'Configure' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(getByRole('status').textContent).toContain('invocation.executable');
    const executable = container.querySelector<HTMLElement>(
      '[data-inspector-field="invocation.executable"]',
    );
    await waitFor(() => expect(executable).toHaveFocus());
  });

  it.each([
    ['executable_not_found', false, 'invocation.executable'],
    ['working_directory_not_found', false, 'invocation.workingDirectory'],
    ['host_environment_variable_missing', false, 'invocation.environment'],
    ['filesystem_reference_inaccessible', false, 'invocation.outputs'],
    ['invalid_json_output', false, 'invocation.outputs'],
    ['process_exit_nonzero', false, 'invocation.arguments'],
    ['process_authentication_failed', false, 'invocation.executable'],
    ['process_authentication_failed', true, 'editor.agentRuntime'],
  ] as const)(
    'maps runtime failure %s to %s',
    (code, agentBlock, expectedField) => {
      expect(runtimeFailureInspectorField(code, agentBlock)).toBe(
        expectedField,
      );
    },
  );

  it('copies and reveals failed evidence, preserves it through edits, and reruns with revised inputs', async () => {
    const workflow = parameterizedWorkflow();
    expect(writeWorkflowDraft({ workflow }, window.localStorage)).toBe(true);
    const retained = retainedFailure(workflow.id);
    vi.mocked(window.vorkflo.listRunHistory).mockResolvedValue([retained]);
    vi.mocked(window.vorkflo.runWorkflow).mockResolvedValue({
      runId: 'corrected-run',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { getByLabelText, getByRole, getByText } = render(<App />);
    const history = getByRole('region', { name: 'Local run history' });
    fireEvent.click(
      await waitFor(() =>
        within(history).getByRole('button', { name: /failed.*failed/i }),
      ),
    );

    fireEvent.click(getByLabelText('Copy failure details'));
    fireEvent.click(getByLabelText('Copy stdout'));
    fireEvent.click(getByLabelText('Copy stderr'));
    fireEvent.click(getByLabelText('Copy file'));
    fireEvent.click(getByLabelText('Reveal file in Finder'));
    await waitFor(() => {
      expect(writeText.mock.calls.map(([value]) => value)).toEqual([
        'process_exit_nonzero\nThe process exited with code 2.\nFix the command and retry.',
        'partial output',
        'bad argument',
        '/tmp/vorkflo-result.txt',
      ]);
      expect(window.vorkflo.revealFilesystemPath).toHaveBeenCalledWith(
        '/tmp/vorkflo-result.txt',
      );
    });

    fireEvent.click(getByRole('tab', { name: 'Configure' }));
    fireEvent.change(getByLabelText(/Executable/), {
      target: { value: 'printf-fixed' },
    });
    fireEvent.click(getByRole('tab', { name: /Run details/ }));
    expect(getByText('partial output')).toBeInTheDocument();
    expect(getByText('bad argument')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Review & Run' }));
    const dialog = getByRole('dialog', { name: 'Review workflow authority' });
    const runInput = within(dialog).getByRole('textbox', {
      name: 'Prompt (text)',
    });
    expect(runInput).toHaveValue('original retained input');
    fireEvent.change(runInput, { target: { value: 'revised input' } });
    expect(getByText('partial output')).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /I reviewed the commands and trust this workflow/,
      }),
    );
    const run = within(dialog).getByRole('button', { name: 'Run workflow' });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);

    await waitFor(() =>
      expect(window.vorkflo.runWorkflow).toHaveBeenCalledWith({
        runId: expect.any(String),
        workflow: expect.objectContaining({
          blocks: [
            expect.objectContaining({
              invocation: expect.objectContaining({
                executable: 'printf-fixed',
              }),
            }),
          ],
        }),
        runInputs: {
          prompt: { kind: 'text', value: 'revised input' },
        },
      }),
    );
  });
});

function failedSnapshot(
  code: 'executable_not_found' | 'process_exit_nonzero',
): RunHistoryRecord['blocks'][number] {
  return {
    blockId: 'welcome',
    state: 'failed',
    inputs: {},
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: code === 'process_exit_nonzero' ? 2 : null,
    failure: {
      code,
      message:
        code === 'executable_not_found'
          ? 'Executable was not found.'
          : 'The process exited with code 2.',
    },
  };
}

function parameterizedWorkflow() {
  const workflow = createWorkflow();
  const block = workflow.blocks[0]!;
  return {
    ...workflow,
    inputs: [
      {
        id: 'prompt',
        name: 'Prompt',
        artifactKind: 'text' as const,
        required: true,
      },
    ],
    inputBindings: [
      {
        id: 'prompt-binding',
        inputId: 'prompt',
        to: { blockId: block.id, portId: 'prompt' },
      },
    ],
    blocks: [
      {
        ...block,
        inputs: [
          {
            id: 'prompt',
            name: 'Prompt',
            artifactKind: 'text' as const,
            required: true,
          },
        ],
        invocation: {
          ...block.invocation,
          arguments: [{ type: 'input' as const, portId: 'prompt' }],
        },
      },
    ],
  };
}

function retainedFailure(workflowId: string): RunHistoryRecord {
  return {
    schemaVersion: 1,
    runId: 'failed-run',
    workflowId,
    workflowName: 'Parameterized workflow',
    startedAt: '2026-07-09T12:00:00.000Z',
    completedAt: '2026-07-09T12:00:01.000Z',
    outcome: 'failed',
    runInputs: {
      prompt: { kind: 'text', value: 'original retained input' },
    },
    blocks: [
      {
        ...failedSnapshot('process_exit_nonzero'),
        stdout: 'partial output',
        stderr: 'bad argument',
        failure: {
          code: 'process_exit_nonzero',
          message: 'The process exited with code 2.',
          nextAction: 'Fix the command and retry.',
          exitCode: 2,
        },
        artifacts: [
          {
            id: 'failed-file',
            kind: 'filesystem-reference',
            path: '/tmp/vorkflo-result.txt',
            entity: 'file',
            provenance: {
              runId: 'failed-run',
              blockId: 'welcome',
              portId: 'file',
              createdAt: '2026-07-09T12:00:01.000Z',
            },
          },
        ],
      },
    ],
  };
}
