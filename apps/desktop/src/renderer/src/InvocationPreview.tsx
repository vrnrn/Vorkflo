import type { BlockPreflightPreview, ProcessBlock } from '@vorkflo/engine';
import { AlertTriangle, ArrowRight, TerminalSquare } from 'lucide-react';

export interface InvocationArgumentPreview {
  readonly position: number;
  readonly source: 'literal' | 'input' | 'template';
  readonly value: string;
}

export interface InvocationEnvironmentPreview {
  readonly name: string;
  readonly source: 'host' | 'literal' | 'input';
  readonly value: string;
  readonly masked: boolean;
}

export interface InvocationPreviewDetails {
  readonly executable: string;
  readonly arguments: readonly InvocationArgumentPreview[];
  readonly shell: boolean;
  readonly shellSyntax: readonly string[];
  readonly workingDirectory: string;
  readonly stdin?: string;
  readonly environment: readonly InvocationEnvironmentPreview[];
  readonly outputs: readonly {
    portId: string;
    declaredPath: string;
    resolvedPath?: string;
  }[];
}

export function buildInvocationPreview(
  block: ProcessBlock,
  resolved?: BlockPreflightPreview,
): InvocationPreviewDetails {
  const literalArguments = block.invocation.arguments.flatMap((argument) =>
    argument.type === 'literal' ? [argument.value] : [],
  );
  return {
    executable: resolved?.resolvedExecutable ?? block.invocation.executable,
    arguments: block.invocation.arguments.map((argument, index) => ({
      position: index + 1,
      source: argument.type,
      value:
        argument.type === 'literal'
          ? argument.value
          : argument.type === 'input'
            ? `input:${argument.portId}`
            : renderTemplatePreview(argument.template, argument.inputs),
    })),
    shell: block.invocation.shell,
    shellSyntax: detectShellSyntax(literalArguments),
    workingDirectory:
      resolved?.workingDirectory ??
      block.invocation.workingDirectory ??
      'application working directory',
    ...(block.invocation.stdin === undefined
      ? {}
      : {
          stdin:
            'portId' in block.invocation.stdin
              ? block.invocation.stdin.portId
              : `template:${renderTemplatePreview(
                  block.invocation.stdin.template,
                  block.invocation.stdin.inputs,
                )}`,
        }),
    environment: Object.entries(block.invocation.environment).map(
      ([name, value]) => ({
        name,
        source: value.source,
        value:
          value.source === 'host'
            ? value.name
            : value.source === 'input'
              ? value.portId
              : '••••••',
        masked: value.source === 'literal',
      }),
    ),
    outputs: block.invocation.outputs.flatMap((binding) => {
      if (binding.type !== 'filesystem') return [];
      return [
        {
          portId: binding.portId,
          declaredPath: binding.path,
          ...(resolved?.outputs.find(
            (output) => output.portId === binding.portId,
          )?.path === undefined
            ? {}
            : {
                resolvedPath: resolved.outputs.find(
                  (output) => output.portId === binding.portId,
                )!.path,
              }),
        },
      ];
    }),
  };
}

export function InvocationPreview({
  block,
  resolved,
}: {
  block: ProcessBlock;
  resolved?: BlockPreflightPreview;
}) {
  const preview = buildInvocationPreview(block, resolved);
  return (
    <section
      className="invocation-preview"
      aria-label="Exact invocation preview"
    >
      <header>
        <TerminalSquare size={14} />
        <strong>Exact invocation</strong>
        <span className={preview.shell ? 'warning-pill' : 'direct-pill'}>
          {preview.shell ? 'SHELL' : 'DIRECT'}
        </span>
      </header>
      <div className="invocation-executable">
        <small>Executable</small>
        <code>{preview.executable}</code>
      </div>
      <ol className="invocation-arguments">
        {preview.arguments.map((argument) => (
          <li key={argument.position}>
            <span>{argument.position}</span>
            <em>{argument.source}</em>
            <code>{argument.value}</code>
          </li>
        ))}
      </ol>
      {preview.arguments.length === 0 && (
        <div className="empty-line">No arguments</div>
      )}
      <dl className="invocation-bindings">
        <dt>Working directory</dt>
        <dd>{preview.workingDirectory}</dd>
        <dt>stdin</dt>
        <dd>
          {preview.stdin === undefined
            ? 'none'
            : preview.stdin.startsWith('template:')
              ? preview.stdin
              : `input:${preview.stdin}`}
        </dd>
        {preview.environment.map((entry) => (
          <div key={entry.name} className="invocation-environment-row">
            <dt>{entry.name}</dt>
            <dd>
              {entry.source} <ArrowRight size={11} /> {entry.value}
              {entry.masked ? ' (masked)' : ''}
            </dd>
          </div>
        ))}
      </dl>
      {preview.outputs.map((output) => (
        <div className="invocation-output" key={output.portId}>
          <small>Filesystem reference: {output.portId}</small>
          <code>{output.resolvedPath ?? output.declaredPath}</code>
          <span>The process must create or update this path.</span>
        </div>
      ))}
      {preview.shellSyntax.length > 0 && (
        <div className={preview.shell ? 'shell-alert active' : 'shell-alert'}>
          <AlertTriangle size={13} />
          <span>
            Shell-only syntax detected: {preview.shellSyntax.join(', ')}.{' '}
            {preview.shell
              ? 'The shell will interpret it.'
              : 'Direct execution passes it literally.'}
          </span>
        </div>
      )}
    </section>
  );
}

function renderTemplatePreview(
  template: string,
  inputs: Readonly<Record<string, { portId: string } | { value: string }>>,
): string {
  return template.replace(
    /\{\{([A-Za-z_][A-Za-z0-9_-]*)\}\}/g,
    (placeholder, name: string) => {
      const binding = inputs[name];
      if (binding === undefined) return placeholder;
      return 'value' in binding ? binding.value : `⟨input:${binding.portId}⟩`;
    },
  );
}

function detectShellSyntax(arguments_: readonly string[]): string[] {
  const detected = new Set<string>();
  for (const value of arguments_) {
    if (/\|/.test(value)) detected.add('pipe (|)');
    if (/(^|\s)(?:>>?|<<?)(?=\s|\S)/.test(value)) detected.add('redirect');
    if (/&&|\|\|/.test(value)) detected.add('command chaining');
    if (/\$\(|`/.test(value)) detected.add('command substitution');
    if (/\$[A-Za-z_{]/.test(value)) detected.add('variable expansion');
    if (/(^|\s)[*?][^\s]*/.test(value)) detected.add('glob expansion');
  }
  return [...detected];
}
