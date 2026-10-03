import { describe, expect, it } from 'vitest';
import { bindRuntimeHelpers } from '../src/main/runtime-helpers';
import { createWorkflow } from '../src/shared/defaults';
import {
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
  setComputerUseBlockPresentation,
} from '../src/shared/computer-use-runtime';
import {
  BUNDLED_IMAGE_REPORT,
  BUNDLED_MCP_PROXY,
} from '../src/shared/runtime-helpers';

function workflow() {
  const config = createDefaultComputerUseConfig({ id: 'browser-task' });
  return setComputerUseBlockPresentation(
    { ...createWorkflow(), blocks: [compileComputerUseBlock(config)] },
    config.id,
    config,
  );
}

describe('installed runtime helpers', () => {
  it('binds helper scripts and policy arguments without mutating the saved definition', () => {
    const portable = workflow();
    const before = JSON.stringify(portable);
    const bound = bindRuntimeHelpers(
      portable,
      '/Applications/Vorkflo.app/Contents/Resources',
    );
    const args = bound.blocks[0]!.invocation.arguments.map((argument) =>
      argument.type === 'literal' ? argument.value : '',
    );
    expect(args[0]).toBe(
      '/Applications/Vorkflo.app/Contents/Resources/helpers/markdown-context-runner/src/image-report-cli.js',
    );
    expect(
      args.some((argument) =>
        argument.includes(
          '/Contents/Resources/helpers/mcp-policy-proxy/src/cli.js',
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(portable)).toBe(before);
  });

  it('does not substitute user prompts or generic process arguments', () => {
    const generic = createWorkflow();
    const block = generic.blocks[0]!;
    const changed = {
      ...generic,
      blocks: [
        {
          ...block,
          invocation: {
            ...block.invocation,
            arguments: [
              { type: 'literal' as const, value: BUNDLED_IMAGE_REPORT },
            ],
          },
        },
      ],
    };
    expect(bindRuntimeHelpers(changed, '/resources')).toEqual(changed);
    const portable = workflow();
    const config = portable.editor!['vorkflo.desktop'] as {
      blockPresentations: Record<string, { config: { instruction: string } }>;
    };
    config.blockPresentations['browser-task']!.config.instruction =
      `Inspect the text ${BUNDLED_MCP_PROXY}`;
    const bound = bindRuntimeHelpers(portable, '/resources');
    expect(JSON.stringify(bound.blocks[0]!.invocation.arguments)).toContain(
      `Inspect the text ${BUNDLED_MCP_PROXY}`,
    );
  });

  it('recompiles stale invocations from the declared editor contract', () => {
    const portable = workflow();
    const block = portable.blocks[0]!;
    const stale = {
      ...portable,
      blocks: [
        {
          ...block,
          invocation: {
            ...block.invocation,
            executable: 'unexpected-command',
            shell: true,
          },
        },
      ],
    };
    const bound = bindRuntimeHelpers(stale, '/resources');
    expect(bound.blocks[0]!.invocation.executable).toBe('node');
    expect(bound.blocks[0]!.invocation.shell).toBe(false);
  });

  it('rejects invalid saved Computer Use metadata before granting process authority', () => {
    const portable = JSON.parse(JSON.stringify(workflow()));
    portable.editor['vorkflo.desktop'].blockPresentations[
      'browser-task'
    ].config.allowedOrigins = [];
    expect(() => bindRuntimeHelpers(portable, '/resources')).toThrow(
      /saved Computer Use configuration/,
    );
  });
});
