import { describe, expect, it } from 'vitest';
import {
  parseWorkflowDefinition,
  validateWorkflow,
  type ProcessBlock,
} from '@vorkflo/engine';
import {
  AGENT_RUNTIME_REGISTRY,
  CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
  alignAgentRuntimeWorkingDirectories,
  agentEditorConfigFromBlock,
  applyUserModelDefaults,
  compileAgentBlock,
  getAgentRuntimeDescriptor,
  getAgentBlockPresentation,
  normalizeAgentRuntimeWorkflow,
  removeBlockPresentation,
  setAgentBlockPresentation,
  type AgentBlockEditorConfig,
} from '../src/shared/agent-runtime';
import { createWorkflow } from '../src/shared/defaults';

describe('Codex Agent runtime compiler', () => {
  it('compiles read-only authority, exact instruction, stdin context, and outputs', () => {
    const instruction =
      'Review this exact input.\nDo not rewrite the request.  ';
    const config: AgentBlockEditorConfig = {
      id: 'agent-1',
      name: 'Review input',
      agentRuntime: 'codex',
      instruction,
      textContext: { portId: 'context', name: 'Context' },
      workingDirectory: '/workspace/project',
      authority: 'read-only',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'report',
          name: 'Report',
          path: './reports/result.md',
          entity: 'file',
        },
        {
          portId: 'assets',
          name: 'Assets',
          path: './generated-assets',
          entity: 'directory',
        },
      ],
    };

    const block = compileAgentBlock(config);

    expect(block).toMatchObject({
      id: 'agent-1',
      name: 'Review input',
      kind: 'process',
      inputs: [
        {
          id: 'context',
          name: 'Context',
          artifactKind: 'text',
          required: false,
        },
      ],
      outputs: [
        { id: 'response', name: 'Response', artifactKind: 'text' },
        {
          id: 'report',
          name: 'Report',
          artifactKind: 'filesystem-reference',
        },
        {
          id: 'assets',
          name: 'Assets',
          artifactKind: 'filesystem-reference',
        },
      ],
      invocation: {
        executable: 'codex',
        workingDirectory: '/workspace/project',
        environment: {
          HOME: { source: 'host', name: 'HOME' },
          PATH: { source: 'host', name: 'PATH' },
        },
        stdin: { portId: 'context' },
        shell: false,
        outputs: [
          { type: 'stdout', portId: 'response' },
          {
            type: 'filesystem',
            portId: 'report',
            path: './reports/result.md',
            entity: 'file',
          },
          {
            type: 'filesystem',
            portId: 'assets',
            path: './generated-assets',
            entity: 'directory',
          },
        ],
      },
    });
    expect(argumentValues(block)).toEqual([
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      instruction,
    ]);
    expect(argumentValues(block).at(-1)).toBe(instruction);
    expect(
      argumentValues(block).filter((value) => value === instruction),
    ).toHaveLength(1);
    expect(
      block.invocation.arguments.every(
        (argument) => argument.type === 'literal',
      ),
    ).toBe(true);
    expectValidStandaloneBlock(block);
  });

  it('compiles explicit workspace-write authority without context or a cwd override', () => {
    const block = compileAgentBlock({
      id: 'agent-write',
      name: 'Generate files',
      agentRuntime: 'codex',
      instruction: 'Create the declared output file.',
      authority: 'workspace-write',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'generated',
          name: 'Generated file',
          path: './generated.txt',
          entity: 'file',
        },
      ],
    });

    expect(block.inputs).toEqual([]);
    expect(block.invocation.stdin).toBeUndefined();
    expect(block.invocation.workingDirectory).toBeUndefined();
    expect(argumentValues(block)).toEqual([
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      'Create the declared output file.',
    ]);
    expect(block.invocation.outputs).toContainEqual({
      type: 'filesystem',
      portId: 'generated',
      path: './generated.txt',
      entity: 'file',
    });
    expectValidStandaloneBlock(block);
  });

  it('compiles six independently named text and JSON reports for a Chief Agent', () => {
    const contexts = [
      ['sourceText', 'Source report', 'text'],
      ['sourceJson', 'Structured report', 'json'],
      ['finance', 'Finance report', 'json'],
      ['chart_spx', 'SPX chart', 'json'],
      ['chart_nvda', 'NVDA chart', 'json'],
      ['chart_btc', 'BTC chart', 'text'],
    ] as const;
    const template = [
      '{{instruction}}',
      ...contexts.map(([key]) => `${key}:\n{{${key}}}`),
    ].join('\n\n');
    const config: AgentBlockEditorConfig = {
      ...baseConfig('codex', 'Produce a proposal-only decision artifact.'),
      instructionDelivery: 'template',
      instructionTemplate: template,
      contexts: contexts.map(([templateKey, name, artifactKind]) => ({
        portId: templateKey,
        name,
        artifactKind,
        templateKey,
        required: true,
      })),
      model: 'user-owned-chief-model',
      reasoningEffort: 'highest-user-setting',
      jsonl: true,
      outputSchemaPath: './schemas/report.schema.json',
      outputLastMessagePath: './report.json',
    };

    const block = compileAgentBlock(config);

    expect(block.inputs).toHaveLength(6);
    expect(
      block.inputs.map(({ id, artifactKind, required }) => ({
        id,
        artifactKind,
        required,
      })),
    ).toEqual(
      contexts.map(([id, , artifactKind]) => ({
        id,
        artifactKind,
        required: true,
      })),
    );
    expect(block.invocation.stdin).toBeUndefined();
    expect(block.invocation.arguments.at(-1)).toEqual({
      type: 'template',
      template,
      inputs: {
        instruction: { value: config.instruction },
        sourceText: { portId: 'sourceText' },
        sourceJson: { portId: 'sourceJson' },
        finance: { portId: 'finance' },
        chart_spx: { portId: 'chart_spx' },
        chart_nvda: { portId: 'chart_nvda' },
        chart_btc: { portId: 'chart_btc' },
      },
    });
    expect(argumentValues(block)).toEqual([
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '--model',
      'user-owned-chief-model',
      '--config',
      'model_reasoning_effort="highest-user-setting"',
      '--output-schema',
      './schemas/report.schema.json',
      '--json',
      '--output-last-message',
      './report.json',
      `template:${template}`,
    ]);
    expect(
      agentEditorConfigFromBlock(block, {
        kind: 'ai-agent',
        agentRuntime: 'codex',
      }),
    ).toEqual(config);
    expect(() =>
      parseWorkflowDefinition({
        schemaVersion: 1,
        id: 'chief-workflow',
        name: 'Chief workflow',
        blocks: [block],
        connections: [],
      }),
    ).not.toThrow();
  });

  it('makes a non-ephemeral Codex choice explicit and round-trippable', () => {
    const config = {
      ...baseConfig('codex', 'Return the result.'),
      ephemeral: false,
    } satisfies AgentBlockEditorConfig;
    const block = compileAgentBlock(config);
    expect(argumentValues(block)).not.toContain('--ephemeral');
    expect(
      agentEditorConfigFromBlock(block, {
        kind: 'ai-agent',
        agentRuntime: 'codex',
      }),
    ).toEqual(config);
  });

  it('never emits model, streaming, resume, shell, worktree, or authority-bypass behavior', () => {
    const block = compileAgentBlock({
      id: 'bounded-agent',
      name: 'Bounded agent',
      agentRuntime: 'codex',
      instruction: 'Return a short response.',
      authority: 'workspace-write',
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
    });
    const arguments_ = argumentValues(block);

    expect(arguments_).not.toContain('--model');
    expect(arguments_).toContain('--skip-git-repo-check');
    expect(arguments_).not.toContain('--json');
    expect(arguments_).not.toContain('resume');
    expect(arguments_).not.toContain('--full-auto');
    expect(arguments_).not.toContain('--ask-for-approval');
    expect(arguments_).not.toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
    expect(arguments_).not.toContain('--dangerously-bypass-hook-trust');
    expect(arguments_).not.toContain('--add-dir');
    expect(block.invocation.shell).toBe(false);
    expect(block.invocation.environment).toEqual({
      HOME: { source: 'host', name: 'HOME' },
      PATH: { source: 'host', name: 'PATH' },
    });
  });

  it('stores only editor identity and reconstructs fields from the compiled process', () => {
    const config: AgentBlockEditorConfig = {
      id: 'agent-metadata',
      name: 'Generate report',
      agentRuntime: 'codex',
      instruction: 'Create report.md',
      authority: 'workspace-write',
      workingDirectory: '/workspace',
      textContext: { portId: 'context', name: 'Context' },
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [
        {
          portId: 'report',
          name: 'Report',
          path: './report.md',
          entity: 'file',
        },
      ],
    };
    const block = compileAgentBlock(config);
    const workflow = setAgentBlockPresentation(
      { ...createWorkflow(), blocks: [block] },
      block.id,
      'codex',
    );
    const presentation = getAgentBlockPresentation(workflow, block.id);

    expect(presentation).toEqual({ kind: 'ai-agent', agentRuntime: 'codex' });
    expect(JSON.stringify(workflow.editor)).not.toContain(config.instruction);
    expect(JSON.stringify(workflow.editor)).not.toContain(
      config.workingDirectory,
    );
    expect(agentEditorConfigFromBlock(block, presentation!)).toEqual(config);
    expect(
      getAgentBlockPresentation(
        removeBlockPresentation(workflow, block.id),
        block.id,
      ),
    ).toBeUndefined();
  });
});

describe('capability-aware Agent runtime registry', () => {
  it('declares stable Codex, Cline, and Antigravity identities', () => {
    expect(AGENT_RUNTIME_REGISTRY.map((runtime) => runtime.id)).toEqual([
      'codex',
      'cline',
      'antigravity',
    ]);
    expect(getAgentRuntimeDescriptor('antigravity')).toMatchObject({
      executable: 'agy',
      modelOverride: true,
      instructionDeliveryModes: ['argument', 'template'],
      capabilities: {
        modelOverride: true,
        instructionDeliveryModes: ['argument', 'template'],
      },
    });
    expect(getAgentRuntimeDescriptor('cline').capabilities).toMatchObject({
      separateTextContext: false,
      structuredEvents: false,
    });
  });

  it('compiles Cline context into its visible positional prompt template', () => {
    const instruction = 'Inspect this repository exactly once.  ';
    const block = compileAgentBlock({
      ...baseConfig('cline', instruction),
      model: 'openai/gpt-5.3-codex',
      instructionDelivery: 'template',
      instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
      textContext: { portId: 'context', name: 'Review context' },
      workingDirectory: '/workspace/project',
      authority: 'read-only',
    });

    expect(block.invocation.executable).toBe('cline');
    expect(argumentValues(block)).toEqual([
      '--plan',
      '--model',
      'openai/gpt-5.3-codex',
      `template:${CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE}`,
    ]);
    expect(block.invocation.stdin).toBeUndefined();
    expect(block.invocation.arguments.at(-1)).toEqual({
      type: 'template',
      template: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
      inputs: {
        instruction: { value: instruction },
        context: { portId: 'context' },
      },
    });
    expect(block.invocation.shell).toBe(false);
    expectForbiddenBypasses(block);
    expect(
      agentEditorConfigFromBlock(block, {
        kind: 'ai-agent',
        agentRuntime: 'cline',
      }),
    ).toMatchObject({
      agentRuntime: 'cline',
      instruction,
      instructionDelivery: 'template',
      instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
      model: 'openai/gpt-5.3-codex',
      authority: 'read-only',
    });
    expectValidStandaloneBlock(block);
  });

  it('migrates legacy Cline stdin context to the positional template', () => {
    const base = compileAgentBlock(
      baseConfig('cline', 'Complete the requested task.'),
    );
    const legacy: ProcessBlock = {
      ...base,
      inputs: [
        {
          id: 'context',
          name: 'Context',
          artifactKind: 'text',
          required: false,
        },
      ],
      invocation: { ...base.invocation, stdin: { portId: 'context' } },
    };
    const workflow = setAgentBlockPresentation(
      { ...createWorkflow(), blocks: [legacy], connections: [] },
      legacy.id,
      'cline',
    );

    expect(
      agentEditorConfigFromBlock(legacy, {
        kind: 'ai-agent',
        agentRuntime: 'cline',
      }),
    ).toMatchObject({
      instructionDelivery: 'template',
      instructionTemplate: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
      textContext: { portId: 'context' },
    });

    const normalized = normalizeAgentRuntimeWorkflow(workflow);
    const migrated = normalized.workflow.blocks[0]!;
    expect(normalized.migratedBlockIds).toEqual([legacy.id]);
    expect(migrated.invocation.stdin).toBeUndefined();
    expect(migrated.invocation.arguments.at(-1)).toMatchObject({
      type: 'template',
      template: CONNECTED_CONTEXT_INSTRUCTION_TEMPLATE,
      inputs: { context: { portId: 'context' } },
    });
  });

  it('applies a machine-local default only when the block has no explicit model', () => {
    const block = compileAgentBlock(baseConfig('codex', 'Review this.'));
    const workflow = setAgentBlockPresentation(
      { ...createWorkflow(), blocks: [block], connections: [] },
      block.id,
      'codex',
    );
    const configured = applyUserModelDefaults(workflow, {
      schemaVersion: 1,
      codex: {
        default: 'test/default-model',
        models: ['test/default-model'],
      },
      cline: { models: [] },
      agy: { models: [] },
    });

    expect(argumentValues(configured.blocks[0]!)).toContain(
      'test/default-model',
    );
  });

  it('compiles Antigravity print mode without permission bypasses', () => {
    const instruction = 'Return a concise architecture note.';
    const block = compileAgentBlock({
      ...baseConfig('antigravity', instruction),
      model: 'gemini-2.5-pro',
      workingDirectory: '/workspace/project',
      authority: 'workspace-write',
    });

    expect(block.invocation.executable).toBe('agy');
    expect(argumentValues(block)).toEqual([
      '--add-dir',
      '/workspace/project',
      '--model',
      'gemini-2.5-pro',
      '--print',
      instruction,
    ]);
    expect(block.invocation.stdin).toBeUndefined();
    expectForbiddenBypasses(block);
    expect(
      agentEditorConfigFromBlock(block, {
        kind: 'ai-agent',
        agentRuntime: 'antigravity',
      }),
    ).toMatchObject({
      agentRuntime: 'antigravity',
      instruction,
      model: 'gemini-2.5-pro',
      authority: 'workspace-write',
      workingDirectory: '/workspace/project',
    });
    expect(argumentValues(block)).not.toContain('--new-project');
    expectValidStandaloneBlock(block);
  });

  it('aligns legacy Antigravity blocks with the final resolved directory', () => {
    const block = compileAgentBlock({
      ...baseConfig('antigravity', 'Inspect the workspace.'),
      authority: 'read-only',
    });
    const workflow = setAgentBlockPresentation(
      {
        ...createWorkflow(),
        blocks: [
          {
            ...block,
            invocation: {
              ...block.invocation,
              workingDirectory: '/resolved/worktree',
            },
          },
        ],
        connections: [],
      },
      block.id,
      'antigravity',
    );

    const aligned = alignAgentRuntimeWorkingDirectories(workflow).blocks[0]!;
    expect(argumentValues(aligned).slice(0, 2)).toEqual([
      '--add-dir',
      '/resolved/worktree',
    ]);
    expect(argumentValues(aligned)).not.toContain('--new-project');
  });

  it('composes exact instruction and connected context through a visible generic argument template', () => {
    const config: AgentBlockEditorConfig = {
      ...baseConfig('antigravity', 'Review the supplied result exactly.'),
      instructionDelivery: 'template',
      instructionTemplate:
        '{{instruction}}\n\nPrior agent result:\n{{context}}',
      textContext: { portId: 'context', name: 'Prior result' },
      authority: 'read-only',
    };

    const block = compileAgentBlock(config);
    expect(block.invocation.stdin).toBeUndefined();
    expect(block.invocation.arguments.at(-1)).toEqual({
      type: 'template',
      template: '{{instruction}}\n\nPrior agent result:\n{{context}}',
      inputs: {
        instruction: { value: 'Review the supplied result exactly.' },
        context: { portId: 'context' },
      },
    });
    expect(
      agentEditorConfigFromBlock(block, {
        kind: 'ai-agent',
        agentRuntime: 'antigravity',
      }),
    ).toEqual(config);
    expectValidStandaloneBlock(block);
  });

  it('rejects instruction and context modes the runtime cannot represent', () => {
    expect(() =>
      compileAgentBlock({
        ...baseConfig('codex', 'Read this file.'),
        instructionDelivery: 'file',
      }),
    ).toThrow('Codex does not support file instruction delivery');

    expect(() =>
      compileAgentBlock({
        ...baseConfig('antigravity', 'Use this context.'),
        textContext: { portId: 'context', name: 'Context' },
      }),
    ).toThrow('cannot receive separate connected text context');
    expect(() =>
      compileAgentBlock({
        ...baseConfig('cline', 'Use this context.'),
        textContext: { portId: 'context', name: 'Context' },
      }),
    ).toThrow('cannot receive separate connected text context');

    expect(() =>
      compileAgentBlock({
        ...baseConfig('codex', 'Use these reports.'),
        instructionDelivery: 'template',
        instructionTemplate: '{{instruction}} {{same}}',
        contexts: [
          {
            portId: 'one',
            name: 'One',
            artifactKind: 'text',
            templateKey: 'same',
          },
          {
            portId: 'two',
            name: 'Two',
            artifactKind: 'json',
            templateKey: 'same',
          },
        ],
      }),
    ).toThrow('template keys must be unique');

    expect(() =>
      compileAgentBlock({
        ...baseConfig('cline', 'Return events.'),
        jsonl: true,
      }),
    ).toThrow('Codex execution options can only be used by Codex Agents');
  });

  it('round-trips runtime and explicit worktree isolation metadata', () => {
    const workflow = setAgentBlockPresentation(
      createWorkflow(),
      'agent-isolated',
      'cline',
      {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/project',
        baseRef: 'main',
        scope: 'shared-review',
      },
    );

    expect(getAgentBlockPresentation(workflow, 'agent-isolated')).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'cline',
      isolation: {
        mode: 'workflow-run-worktree',
        repositoryRoot: '/workspace/project',
        baseRef: 'main',
        scope: 'shared-review',
      },
    });
  });

  it('preserves unsupported metadata until explicitly removed', () => {
    const workflow = {
      ...createWorkflow(),
      editor: {
        'vorkflo.desktop': {
          schemaVersion: 1,
          blockPresentations: {
            welcome: { kind: 'ai-agent', agentRuntime: 'future-agent' },
            untouched: { kind: 'future-presentation', value: 1 },
          },
        },
      },
    };

    expect(JSON.stringify(workflow.editor)).toContain('future-agent');
    const recovered = removeBlockPresentation(workflow, 'welcome');
    expect(JSON.stringify(recovered.editor)).not.toContain('future-agent');
    expect(JSON.stringify(recovered.editor)).toContain('future-presentation');
  });

  it('preserves non-Agent presentation metadata when setting an Agent presentation', () => {
    const workflow = {
      ...createWorkflow(),
      editor: {
        'vorkflo.desktop': {
          schemaVersion: 1,
          blockPresentations: {
            browser: {
              kind: 'computer-use',
              targetUrl: 'https://example.test',
            },
          },
        },
      },
    };
    const updated = setAgentBlockPresentation(workflow, 'chief', 'codex');
    expect(JSON.stringify(updated.editor)).toContain('computer-use');
    expect(getAgentBlockPresentation(updated, 'chief')).toEqual({
      kind: 'ai-agent',
      agentRuntime: 'codex',
    });
  });
});

function baseConfig(
  agentRuntime: AgentBlockEditorConfig['agentRuntime'],
  instruction: string,
): AgentBlockEditorConfig {
  return {
    id: `${agentRuntime}-agent`,
    name: `${agentRuntime} agent`,
    agentRuntime,
    instruction,
    authority: 'workspace-write',
    textResponse: { portId: 'response', name: 'Response' },
    filesystemOutputs: [],
  };
}

function expectForbiddenBypasses(block: ProcessBlock): void {
  const arguments_ = argumentValues(block);
  expect(arguments_).not.toContain('--yolo');
  expect(arguments_).not.toContain('--auto-approve');
  expect(arguments_).not.toContain('--dangerously-skip-permissions');
  expect(arguments_).not.toContain(
    '--dangerously-bypass-approvals-and-sandbox',
  );
}

function argumentValues(block: ProcessBlock): string[] {
  return block.invocation.arguments.map((argument) => {
    return argument.type === 'literal'
      ? argument.value
      : argument.type === 'input'
        ? `input:${argument.portId}`
        : `template:${argument.template}`;
  });
}

function expectValidStandaloneBlock(block: ProcessBlock): void {
  const workflow = parseWorkflowDefinition({
    schemaVersion: 1,
    id: 'agent-workflow',
    name: 'Agent workflow',
    blocks: [block],
    connections: [],
  });
  expect(validateWorkflow(workflow)).toEqual({ valid: true, issues: [] });
}
