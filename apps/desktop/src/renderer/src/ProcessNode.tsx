import { createContext, memo, useContext } from 'react';
import {
  Handle,
  NodeToolbar,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { BlockExecutionState, ProcessBlock } from '@vorkflo/engine';
import {
  Bot,
  Box,
  ClipboardPaste,
  Copy,
  MonitorUp,
  TerminalSquare,
} from 'lucide-react';
import type { AgentRuntimeId } from '../../shared/agent-runtime';

export interface ProcessNodeData extends Record<string, unknown> {
  readonly block: ProcessBlock;
  readonly status: BlockExecutionState | 'idle';
  readonly agentRuntime?: AgentRuntimeId;
  readonly presentationKind?: 'computer-use';
}

export type ProcessFlowNode = Node<ProcessNodeData, 'process'>;

export interface ProcessNodeActions {
  readonly onCopy: (blockId: string) => void;
  readonly onPaste: () => void;
  readonly pasteDisabled: boolean;
}

const ProcessNodeActionsContext = createContext<ProcessNodeActions | null>(
  null,
);
export const ProcessNodeActionsProvider = ProcessNodeActionsContext.Provider;

export const ProcessNode = memo(function ProcessNode({
  id,
  data,
  selected,
}: NodeProps<ProcessFlowNode>) {
  const actions = useContext(ProcessNodeActionsContext);
  if (actions === null)
    throw new Error('Process node actions are unavailable.');
  const { onCopy, onPaste, pasteDisabled } = actions;
  const { agentRuntime, block, presentationKind, status } = data;
  const blockType =
    presentationKind === 'computer-use'
      ? 'Computer Use'
      : agentRuntime === undefined
        ? 'Process'
        : 'AI Agent';
  return (
    <>
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="node-action-toolbar"
      >
        <button
          type="button"
          className="node-action-button nodrag nowheel"
          aria-label="Copy block"
          title="Copy block"
          onClick={(event) => {
            event.stopPropagation();
            onCopy(id);
          }}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          className="node-action-button nodrag nowheel"
          aria-label="Paste block"
          title="Paste block at the canvas pointer"
          disabled={pasteDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onPaste();
          }}
        >
          <ClipboardPaste size={13} />
        </button>
      </NodeToolbar>
      <article
        className={`process-node kind-${presentationKind ?? (agentRuntime === undefined ? 'process' : 'agent')} state-${status} ${selected ? 'selected' : ''}`}
        aria-label={`${blockType} ${block.name}, ${status}`}
      >
        <div className="node-accent" />
        <header>
          <span className="node-icon">
            {presentationKind === 'computer-use' ? (
              <MonitorUp size={14} />
            ) : agentRuntime === undefined ? (
              <TerminalSquare size={14} />
            ) : (
              <Bot size={14} />
            )}
          </span>
          <div className="node-heading">
            <small>{blockType}</small>
            <span className="node-title" title={block.name}>
              {block.name}
            </span>
          </div>
          <span
            className={`status-dot ${status}`}
            title={status}
            aria-hidden="true"
          />
        </header>
        <div className="node-command">
          <code>{block.invocation.executable}</code>
          {agentRuntime !== undefined && (
            <span className="agent-runtime-pill">{agentRuntime}</span>
          )}
          {presentationKind === 'computer-use' && (
            <span className="agent-runtime-pill">codex + policy MCP</span>
          )}
          {block.invocation.shell && <span className="shell-pill">shell</span>}
        </div>
        <div className="ports inputs">
          {block.inputs.map((port) => (
            <div className="port-row input-port" key={port.id}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                className={`flow-handle kind-${port.artifactKind}`}
              />
              <span>{port.name}</span>
              <small>{kindLabel(port.artifactKind)}</small>
            </div>
          ))}
        </div>
        <div className="ports outputs">
          {block.outputs.map((port) => (
            <div className="port-row output-port" key={port.id}>
              <small>{kindLabel(port.artifactKind)}</small>
              <span>{port.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className={`flow-handle kind-${port.artifactKind}`}
              />
            </div>
          ))}
        </div>
        {block.inputs.length === 0 && block.outputs.length === 0 && (
          <div className="node-empty">
            <Box size={13} /> No ports
          </div>
        )}
        <footer className={`node-state ${status}`}>
          <span className={`status-dot ${status}`} aria-hidden="true" />
          {status === 'idle' ? 'Not run yet' : status}
        </footer>
      </article>
    </>
  );
});

function kindLabel(kind: string): string {
  if (kind === 'filesystem-reference') return 'file';
  return kind;
}
