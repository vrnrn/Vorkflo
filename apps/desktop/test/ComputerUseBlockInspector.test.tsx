import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerUseBlockInspector } from '../src/renderer/src/ComputerUseBlockInspector';
import {
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
} from '../src/shared/computer-use-runtime';

afterEach(cleanup);

describe('Computer Use block editor', () => {
  it('presents bounded authority, controller, outputs, and invocation as named groups', () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const { getByText, queryByRole } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(getByText('Bounded browser session')).toBeInTheDocument();
    expect(getByText('Research only')).toBeInTheDocument();
    expect(getByText('Codex controller')).toBeInTheDocument();
    expect(getByText('Declared outputs')).toBeInTheDocument();
    expect(getByText('Effective invocation')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Choose' })).not.toBeInTheDocument();
  });

  it('keeps invalid intermediate edits local and applies a corrected value', () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const onChange = vi.fn();
    const { getByLabelText, getByRole, queryByRole } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={vi.fn()}
        onChange={onChange}
      />,
    );
    fireEvent.change(getByLabelText('Start URL'), {
      target: { value: 'https://' },
    });
    expect(getByRole('alert')).toHaveTextContent('Changes not applied');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(getByLabelText('Start URL'), {
      target: { value: 'https://example.com/docs' },
    });
    expect(queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange.mock.calls.at(-1)?.[1].config.startUrl).toBe(
      'https://example.com/docs',
    );
  });

  it('uses accessible path actions and preserves the selected local path', async () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const onChange = vi.fn();
    const selectPath = vi.fn().mockResolvedValue('/safe/browser-policy.json');
    const { getByLabelText } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={selectPath}
        onChange={onChange}
      />,
    );

    fireEvent.click(getByLabelText('Choose browser policy manifest'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(selectPath).toHaveBeenCalledWith(
      'file',
      './browser-policy.manifest.json',
    );
    expect(onChange.mock.calls.at(-1)?.[1].config.mcpPolicyManifestPath).toBe(
      '/safe/browser-policy.json',
    );
  });
});
