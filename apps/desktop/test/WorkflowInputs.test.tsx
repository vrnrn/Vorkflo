import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RunInputFields,
  WorkflowInputsEditor,
} from '../src/renderer/src/WorkflowInputs';
import { createWorkflow } from '../src/shared/defaults';

afterEach(cleanup);

describe('workflow input controls', () => {
  it('edits an explicitly stored JSON default as typed JSON', () => {
    const workflow = {
      ...createWorkflow(),
      inputs: [
        {
          id: 'settings',
          name: 'Settings',
          artifactKind: 'json' as const,
          required: false,
          defaultValue: { kind: 'json' as const, value: null },
        },
      ],
    };
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = render(
      <WorkflowInputsEditor
        workflow={workflow}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );
    const editor = getByLabelText('Stored JSON default for Settings');

    fireEvent.change(editor, { target: { value: '{' } });
    expect(getByRole('alert')).toHaveTextContent('Enter valid JSON');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: '{"mode":"compact"}' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [
          expect.objectContaining({
            defaultValue: {
              kind: 'json',
              value: { mode: 'compact' },
            },
          }),
        ],
      }),
    );
  });

  it('offers native file and directory selection for filesystem run inputs', async () => {
    const workflow = {
      ...createWorkflow(),
      inputs: [
        {
          id: 'source',
          name: 'Source',
          artifactKind: 'filesystem-reference' as const,
          required: true,
        },
      ],
    };
    const selectPath = vi.fn(
      async (kind: 'file' | 'directory' | 'output-file') =>
        kind === 'file' ? '/tmp/source.txt' : '/tmp/source-directory',
    );
    const onChange = vi.fn();
    const { getByRole } = render(
      <RunInputFields
        workflow={workflow}
        values={{}}
        errors={{}}
        onChange={onChange}
        selectPath={selectPath}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Choose file input Source' }));
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('source', '/tmp/source.txt'),
    );
    fireEvent.click(
      getByRole('button', { name: 'Choose directory input Source' }),
    );
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('source', '/tmp/source-directory'),
    );
  });
});
