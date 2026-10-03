import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/src/App';
import type { DraftStorage } from '../src/renderer/src/draft-store';

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

describe('v0.2 primary editor accessibility acceptance', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: new TestDraftStorage(),
    });
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
        saveWorkflow: vi.fn(),
        selectFilesystemPath: vi.fn(),
        openFilesystemPath: vi.fn().mockResolvedValue(undefined),
        revealFilesystemPath: vi.fn(),
        listRunHistory: vi.fn().mockResolvedValue([]),
        clearRunHistory: vi.fn(),
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

  it('gives the primary editor controls stable accessible names and keyboard focus', () => {
    const { container, getByLabelText, getByRole } = render(<App />);
    const namedControls = [
      'New',
      'Open',
      'Save',
      'Save As',
      'Undo',
      'Redo',
      'Copy block',
      'Paste block',
      'Auto arrange',
      'Add process',
      'Add AI Agent',
    ];

    expect(getByRole('main')).toBeInTheDocument();
    expect(
      getByRole('region', { name: 'Workflow canvas' }),
    ).toBeInTheDocument();
    expect(
      getByRole('region', { name: 'Workflow inputs' }),
    ).toBeInTheDocument();
    expect(
      getByRole('region', { name: 'Local run history' }),
    ).toBeInTheDocument();
    expect(getByLabelText('Canvas controls')).toBeInTheDocument();
    expect(getByLabelText('Workflow name')).toHaveAccessibleName(
      'Workflow name',
    );

    for (const name of namedControls) {
      const control = getByRole('button', { name });
      expect(control).toHaveAccessibleName(name);
      expect(control.tabIndex).toBe(0);
    }

    for (const control of container.querySelectorAll('.toolbar-button')) {
      expect(control).toHaveAttribute('data-tooltip');
      expect(control.getAttribute('data-tooltip')).not.toBe('');
    }
  });

  it('supports standard keyboard navigation for the labelled inspector tabs', async () => {
    const { getByRole } = render(<App />);
    const tablist = getByRole('tablist');
    const configure = within(tablist).getByRole('tab', { name: 'Configure' });
    const runDetails = within(tablist).getByRole('tab', {
      name: 'Run details',
    });

    expect(configure).toHaveAttribute('aria-selected', 'true');
    expect(runDetails).toHaveAttribute('aria-selected', 'false');
    expect(configure).toHaveAttribute(
      'aria-controls',
      'inspector-configure-panel',
    );
    expect(configure).toHaveAttribute('tabindex', '0');
    expect(runDetails).toHaveAttribute('tabindex', '-1');

    configure.focus();
    fireEvent.keyDown(configure, { key: 'ArrowRight' });
    expect(configure).toHaveAttribute('aria-selected', 'false');
    expect(runDetails).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(runDetails).toHaveFocus());
    expect(getByRole('tabpanel')).toHaveAccessibleName('Run details');

    fireEvent.keyDown(runDetails, { key: 'Home' });
    await waitFor(() => expect(configure).toHaveFocus());
    expect(getByRole('tabpanel')).toHaveAccessibleName('Configure');

    expect(
      getByRole('combobox', { name: 'Environment source for PATH' }),
    ).toBeInTheDocument();
    expect(
      getByRole('button', { name: 'Remove environment variable PATH' }),
    ).toBeInTheDocument();
    expect(getByRole('button', { name: 'Delete block' })).toBeInTheDocument();
  });

  it('announces and labels the executable authority review controls', async () => {
    const { getByRole } = render(<App />);

    await waitFor(() =>
      expect(window.vorkflo.preflightWorkflow).toHaveBeenCalled(),
    );
    const review = getByRole('button', { name: 'Review & Run' });
    review.focus();
    fireEvent.click(review);

    const dialog = getByRole('dialog', { name: 'Review workflow authority' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      within(dialog).getByRole('heading', { name: 'Review before running' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('This workflow is executable code.'),
    ).toBeInTheDocument();

    const trust = within(dialog).getByRole('checkbox', {
      name: /I reviewed the commands and trust this workflow/i,
    });
    const run = within(dialog).getByRole('button', { name: 'Run workflow' });
    expect(trust).not.toBeChecked();
    expect(run).toBeDisabled();
    fireEvent.click(trust);
    expect(trust).toBeChecked();
    expect(run).toBeEnabled();
    const close = within(dialog).getByRole('button', {
      name: 'Close run review',
    });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(close).toHaveAccessibleName('Close run review');
    expect(close).toHaveFocus();
    expect(cancel).toBeEnabled();

    run.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(run).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(getByRole('button', { name: 'Review & Run' })).toHaveFocus();
    expect(
      document.querySelector('[aria-label="Review workflow authority"]'),
    ).toBeNull();
  });
});
