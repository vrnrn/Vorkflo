import { describe, expect, it } from 'vitest';
import { buildInvocationPreview } from '../src/renderer/src/InvocationPreview';
import { createProcessBlock } from '../src/shared/defaults';

describe('exact invocation preview', () => {
  it('preserves argument positions, bindings, masking, and resolved paths', () => {
    const base = createProcessBlock('preview');
    const block = {
      ...base,
      inputs: [
        {
          id: 'context',
          name: 'Context',
          artifactKind: 'text' as const,
          required: true,
        },
      ],
      outputs: [
        ...base.outputs,
        {
          id: 'file',
          name: 'File',
          artifactKind: 'filesystem-reference' as const,
        },
      ],
      invocation: {
        ...base.invocation,
        arguments: [
          { type: 'literal' as const, value: '--message' },
          { type: 'input' as const, portId: 'context' },
          { type: 'literal' as const, value: '>> output.txt' },
        ],
        stdin: { portId: 'context' },
        environment: {
          TOKEN: { source: 'literal' as const, value: 'secret-value' },
          PATH: { source: 'host' as const, name: 'PATH' },
        },
        outputs: [
          ...base.invocation.outputs,
          {
            type: 'filesystem' as const,
            portId: 'file',
            path: './output.txt',
            entity: 'file' as const,
          },
        ],
      },
    };

    const preview = buildInvocationPreview(block, {
      blockId: block.id,
      executable: 'printf',
      resolvedExecutable: '/usr/bin/printf',
      workingDirectory: '/workspace',
      shell: false,
      outputs: [
        { portId: 'file', path: '/workspace/output.txt', entity: 'file' },
      ],
    });

    expect(preview.arguments).toEqual([
      { position: 1, source: 'literal', value: '--message' },
      { position: 2, source: 'input', value: 'input:context' },
      { position: 3, source: 'literal', value: '>> output.txt' },
    ]);
    expect(preview.stdin).toBe('context');
    expect(preview.environment).toEqual([
      { name: 'TOKEN', source: 'literal', value: '••••••', masked: true },
      { name: 'PATH', source: 'host', value: 'PATH', masked: false },
    ]);
    expect(JSON.stringify(preview)).not.toContain('secret-value');
    expect(preview.outputs[0]?.resolvedPath).toBe('/workspace/output.txt');
    expect(preview.shellSyntax).toContain('redirect');
  });

  it('shows literal template values and explicit routed-input boundaries', () => {
    const base = createProcessBlock('template-preview');
    const preview = buildInvocationPreview({
      ...base,
      invocation: {
        ...base.invocation,
        arguments: [
          {
            type: 'template',
            template: '{{instruction}}\nContext:\n{{context}}',
            inputs: {
              instruction: { value: 'Review exactly.' },
              context: { portId: 'context' },
            },
          },
        ],
      },
    });

    expect(preview.arguments).toEqual([
      {
        position: 1,
        source: 'template',
        value: 'Review exactly.\nContext:\n⟨input:context⟩',
      },
    ]);
  });
});
