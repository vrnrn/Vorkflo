import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileAgentBlock,
  type AgentBlockEditorConfig,
} from '../src/shared/agent-runtime';
import { AgentBlockInspector } from '../src/renderer/src/AgentBlockInspector';

afterEach(cleanup);

describe('AI Agent block editor', () => {
  it('recompiles exact instructions and visible workspace authority', () => {
    const block = compileAgentBlock(config());
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={block}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText('Agent instruction'), {
      target: { value: 'Create the exact report.' },
    });
    const instructionBlock = onChange.mock.calls.at(-1)?.[0];
    expect(instructionBlock.invocation.arguments.at(-1)).toEqual({
      type: 'literal',
      value: 'Create the exact report.',
    });

    fireEvent.change(getByLabelText('Agent authority'), {
      target: { value: 'workspace-write' },
    });
    const authorityBlock = onChange.mock.calls.at(-1)?.[0];
    expect(
      authorityBlock.invocation.arguments.map(
        (argument: { type: string; value?: string }) => argument.value,
      ),
    ).toContain('workspace-write');
    expect(authorityBlock.invocation.shell).toBe(false);
  });

  it('adds declared filesystem outputs without creating them implicitly', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Add' }));
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.outputs).toContainEqual(
      expect.objectContaining({ artifactKind: 'filesystem-reference' }),
    );
    expect(next.invocation.outputs).toContainEqual(
      expect.objectContaining({ type: 'filesystem', entity: 'file' }),
    );
  });

  it('selects Codex, Cline, or Antigravity through the runtime registry', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    const runtime = getByLabelText('Agent runtime');
    expect(runtime).not.toBeDisabled();
    expect(getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Cline' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Antigravity' })).toBeInTheDocument();

    fireEvent.change(runtime, { target: { value: 'cline' } });
    expect(onChange.mock.calls.at(-1)?.[0].invocation.executable).toBe('cline');
    expect(onChange.mock.calls.at(-1)?.[1]).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'cline',
    });
  });

  it('offers configured models, applies the file default, and allows custom IDs', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
        modelCatalog={{
          schemaVersion: 1,
          codex: {
            default: 'test/default-model',
            models: ['test/default-model', 'test/fast-model'],
          },
          cline: { models: [] },
          agy: { models: [] },
        }}
        modelCatalogPath="/home/test/.vorkflo/models.json"
      />,
    );

    expect(getByLabelText('Agent model')).toHaveValue('configured:0');
    expect(
      getByRole('region', { name: 'Exact invocation preview' }),
    ).toHaveTextContent('test/default-model');
    fireEvent.change(getByLabelText('Agent model'), {
      target: { value: 'configured:1' },
    });
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .invocation.arguments.map(
          (argument: { type: string; value?: string }) => argument.value,
        ),
    ).toContain('test/fast-model');
    expect(getByRole('option', { name: 'Custom…' })).toBeInTheDocument();

    cleanup();
    const custom = render(
      <AgentBlockInspector
        block={compileAgentBlock({ ...config(), model: 'custom/initial' })}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
        modelCatalog={{
          schemaVersion: 1,
          codex: { models: ['test/default-model'] },
          cline: { models: [] },
          agy: { models: [] },
        }}
      />,
    );
    expect(custom.getByLabelText('Agent model')).toHaveValue('custom');
    fireEvent.change(custom.getByLabelText('Agent model override'), {
      target: { value: 'custom/exact-model' },
    });
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .invocation.arguments.map(
          (argument: { type: string; value?: string }) => argument.value,
        ),
    ).toContain('custom/exact-model');
  });

  it('renders capability-driven instruction delivery and context controls', () => {
    const onChange = vi.fn();
    const withContext: AgentBlockEditorConfig = {
      ...config(),
      textContext: { portId: 'context', name: 'Reference material' },
    };
    const { getByLabelText, getAllByRole } = render(
      <AgentBlockInspector
        block={compileAgentBlock(withContext)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Instruction delivery')).toHaveValue('argument');
    expect(getAllByRole('option', { name: 'Exact CLI argument' })).toHaveLength(
      1,
    );
    fireEvent.change(getByLabelText('Agent context input name'), {
      target: { value: 'Design brief' },
    });
    expect(onChange.mock.calls.at(-1)?.[0].inputs).toContainEqual(
      expect.objectContaining({ name: 'Design brief' }),
    );

    fireEvent.change(getByLabelText('Agent runtime'), {
      target: { value: 'antigravity' },
    });
    const converted = onChange.mock.calls.at(-1)?.[0];
    expect(converted.inputs).toContainEqual(
      expect.objectContaining({ id: 'context', name: 'Reference material' }),
    );
    expect(converted.invocation.stdin).toBeUndefined();
    expect(converted.invocation.arguments.at(-1)).toMatchObject({
      type: 'template',
      inputs: { context: { portId: 'context' } },
    });
  });

  it('edits a visible deterministic template that binds exact instruction and context', () => {
    const onChange = vi.fn();
    const templated: AgentBlockEditorConfig = {
      ...config(),
      agentRuntime: 'antigravity',
      instructionDelivery: 'template',
      instructionTemplate: '{{instruction}}\nContext:\n{{context}}',
      textContext: { portId: 'context', name: 'Context' },
    };
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(templated)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'antigravity' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Instruction delivery')).toHaveValue('template');
    fireEvent.change(getByLabelText('Agent instruction template'), {
      target: {
        value: 'Task:\n{{instruction}}\nPrior result:\n{{context}}',
      },
    });
    expect(onChange.mock.calls.at(-1)?.[0].invocation.arguments.at(-1)).toEqual(
      {
        type: 'template',
        template: 'Task:\n{{instruction}}\nPrior result:\n{{context}}',
        inputs: {
          instruction: { value: 'Respond with text.' },
          context: { portId: 'context' },
        },
      },
    );
  });

  it('persists explicit workflow-run worktree settings with presentation metadata', () => {
    const onChange = vi.fn();
    const isolated: AgentBlockEditorConfig = {
      ...config(),
      authority: 'workspace-write',
      isolation: {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/repository',
        baseRef: 'main',
        scope: 'shared-review',
      },
    };
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(isolated)}
        presentation={{
          kind: 'ai-agent',
          agentRuntime: 'codex',
          isolation: isolated.isolation!,
        }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Agent isolation')).toHaveValue(
      'workflow-run-worktree',
    );
    expect(getByLabelText('Worktree repository root')).toHaveValue(
      '/workspace/repository',
    );
    fireEvent.change(getByLabelText('Worktree base ref'), {
      target: { value: 'release/v0.3' },
    });

    expect(onChange.mock.calls.at(-1)?.[1]).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'codex',
      isolation: {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/repository',
        baseRef: 'release/v0.3',
        scope: 'shared-review',
      },
    });
  });

  it('resolves a user-owned highest-intelligence profile to exact visible Codex args', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(config())}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
        modelCatalog={{
          schemaVersion: 1,
          codex: {
            models: ['user/chief'],
            intelligenceProfiles: [
              {
                name: 'highest intelligence',
                model: 'user/chief',
                reasoningEffort: 'xhigh',
              },
            ],
          },
          cline: { models: [] },
          agy: { models: [] },
        }}
      />,
    );

    fireEvent.change(getByLabelText('Codex intelligence profile'), {
      target: { value: '0' },
    });
    const values = onChange.mock.calls
      .at(-1)?.[0]
      .invocation.arguments.map(
        (argument: { type: string; value?: string }) => argument.value,
      );
    expect(values).toContain('user/chief');
    expect(values).toContain('model_reasoning_effort="xhigh"');
  });

  it('edits explicit Codex structured output settings', () => {
    const onChange = vi.fn();
    const configured = {
      ...config(),
      reasoningEffort: 'high',
      jsonl: true,
      outputSchemaPath: './schema.json',
      outputLastMessagePath: './report.json',
    } satisfies AgentBlockEditorConfig;
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(configured)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    expect(getByLabelText('Codex reasoning effort')).toHaveValue('high');
    expect(getByLabelText('Codex JSONL events')).toBeChecked();
    expect(getByLabelText('Codex output schema path')).toHaveValue(
      './schema.json',
    );
    expect(getByLabelText('Codex final message output path')).toHaveValue(
      './report.json',
    );
    fireEvent.click(getByLabelText('Ephemeral Codex session'));
    expect(
      onChange.mock.calls
        .at(-1)?.[0]
        .invocation.arguments.some(
          (argument: { type: string; value?: string }) =>
            argument.value === '--ephemeral',
        ),
    ).toBe(false);
  });

  it('adds a second named context and switches to an explicit multi-input template', () => {
    const onChange = vi.fn();
    const firstContext = {
      ...config(),
      textContext: { portId: 'context', name: 'Source report' },
    } satisfies AgentBlockEditorConfig;
    const { getByLabelText } = render(
      <AgentBlockInspector
        block={compileAgentBlock(firstContext)}
        presentation={{ kind: 'ai-agent', agentRuntime: 'codex' }}
        onChange={onChange}
        selectPath={vi.fn()}
      />,
    );

    fireEvent.click(getByLabelText('Add Agent context input'));
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.inputs).toHaveLength(2);
    expect(next.invocation.stdin).toBeUndefined();
    expect(next.invocation.arguments.at(-1)).toMatchObject({
      type: 'template',
      inputs: {
        context: { portId: 'context' },
        context_2: { portId: 'context-1' },
      },
    });
  });
});

function config(): AgentBlockEditorConfig {
  return {
    id: 'agent',
    name: 'Agent',
    agentRuntime: 'codex',
    instruction: 'Respond with text.',
    authority: 'read-only',
    textResponse: { portId: 'response', name: 'Response' },
    filesystemOutputs: [],
  };
}
