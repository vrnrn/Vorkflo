import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection as FlowConnection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  parseWorkflowRunInputs,
  validateWorkflow,
  type BlockExecutionState,
  type ExecutionFailure,
  type WorkflowPreflightResult,
  type WorkflowRunInputs,
  type WorkflowDefinition,
} from '@vorkflo/engine';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers3,
  LoaderCircle,
  MonitorUp,
  Network,
  PanelLeft,
  PanelRight,
  PanelRightClose,
  Play,
  Plus,
  Redo2,
  Save,
  SaveAll,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import type {
  BlockRunSnapshot,
  DesktopRunEvent,
  RunHistoryRecord,
  UserModelCatalogResult,
} from '../../shared/contracts';
import {
  AGENT_RUNTIME_REGISTRY,
  agentEditorConfigFromBlock,
  compileAgentBlock,
  getAgentBlockMetadataIssue,
  getAgentBlockPresentation,
  normalizeAgentRuntimeWorkflow,
  removeBlockPresentation,
  setAgentBlockPresentation,
  type AgentBlockMetadataIssue,
  type AgentBlockPresentation,
  type AgentRuntimeId,
} from '../../shared/agent-runtime';
import {
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
  getComputerUseBlockMetadataIssue,
  getComputerUseBlockPresentation,
  setComputerUseBlockPresentation,
  type ComputerUseBlockPresentation,
} from '../../shared/computer-use-runtime';
import { createProcessBlock, createWorkflow } from '../../shared/defaults';
import { AgentBlockInspector } from './AgentBlockInspector';
import { ComputerUseBlockInspector } from './ComputerUseBlockInspector';
import {
  clearWorkflowDraft,
  readWorkflowDraft,
  writeWorkflowDraft,
} from './draft-store';
import {
  ProcessNode,
  ProcessNodeActionsProvider,
  type ProcessFlowNode,
} from './ProcessNode';
import {
  ArtifactEdge,
  findRoutedFileArtifact,
  type ArtifactFlowEdge,
} from './ArtifactEdge';
import { ProcessBlockInspector } from './ProcessBlockInspector';
import { RunInspector, RunPreview } from './RunInspector';

import { RunHistoryPanel } from './RunHistoryPanel';
import { WorkflowInputsEditor } from './WorkflowInputs';
import {
  buildWorkflowRunInputs,
  serializeRunInputValue,
} from './workflow-inputs';
import {
  autoArrangeWorkflow,
  connectBlocks,
  copyProcessBlock,
  createWorkflowHistory,
  pasteProcessBlock,
  removeBlock,
  reconcileProcessNodes,
  redoWorkflowHistory,
  replaceBlock,
  setBlockPosition,
  pushWorkflowHistory,
  undoWorkflowHistory,
  type ProcessBlockClipboard,
  type WorkflowHistory,
} from './workflow';

type InspectorTab = 'configure' | 'run';
type InspectorFocusRequest = {
  readonly blockId: string;
  readonly field: string;
  readonly nonce: number;
};

const edgeTypes = { artifact: ArtifactEdge } as const;
// Component types must stay stable across workflow edits. Recreating the node
// renderer remounts every node even when only its position changed.
const nodeTypes = { process: ProcessNode } as const;

export function App() {
  const [recoveredDraft] = useState(readWorkflowDraft);
  const [history, setHistory] = useState<WorkflowHistory>(() =>
    createWorkflowHistory(recoveredDraft?.workflow ?? createWorkflow()),
  );
  const workflow = history.present;
  const [nodes, setNodes] = useState<ProcessFlowNode[]>([]);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [filePath, setFilePath] = useState<string | undefined>(
    recoveredDraft?.filePath,
  );
  const [dirty, setDirty] = useState(recoveredDraft !== undefined);
  const [historyBaselineDirty, setHistoryBaselineDirty] = useState(
    recoveredDraft !== undefined,
  );
  const canvasRef = useRef<HTMLElement>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    ProcessFlowNode,
    ArtifactFlowEdge
  > | null>(null);
  const lastCanvasPointerRef = useRef<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string>(
    workflow.blocks[0]?.id ?? '',
  );
  const [blockClipboard, setBlockClipboard] = useState<ProcessBlockClipboard>();
  const [blockClipboardPresentation, setBlockClipboardPresentation] = useState<
    AgentBlockPresentation | ComputerUseBlockPresentation
  >();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('configure');
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [snapshots, setSnapshots] = useState<
    Readonly<Record<string, BlockRunSnapshot>>
  >({});
  const [activeRunId, setActiveRunId] = useState<string>();
  const [runOutcome, setRunOutcome] = useState<
    'succeeded' | 'failed' | 'cancelled'
  >();
  const [runPreviewOpen, setRunPreviewOpen] = useState(false);
  const [plannedRunId, setPlannedRunId] = useState(() => crypto.randomUUID());
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [runInputValues, setRunInputValues] = useState<
    Readonly<Record<string, string>>
  >({});
  const [preflight, setPreflight] = useState<WorkflowPreflightResult>();
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [runHistory, setRunHistory] = useState<readonly RunHistoryRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [inspectorFocusRequest, setInspectorFocusRequest] =
    useState<InspectorFocusRequest>();
  const [userModelCatalog, setUserModelCatalog] =
    useState<UserModelCatalogResult>();
  const [notice, setNotice] = useState<string | undefined>(
    recoveredDraft === undefined ? undefined : 'Recovered unsaved draft.',
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let previousSize: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      const instance = reactFlowInstanceRef.current;
      if (previousSize !== undefined && instance !== null) {
        // Keep the same graph point centered when panels or the window resize.
        // Preserve the user's zoom and layout instead of arranging the graph.
        const viewport = instance.getViewport();
        void instance.setViewport({
          ...viewport,
          x: viewport.x + (width - previousSize.width) / 2,
          y: viewport.y + (height - previousSize.height) / 2,
        });
      }
      previousSize = { width, height };
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const selectedBlock = workflow.blocks.find(
    (block) => block.id === selectedBlockId,
  );
  const selectedPresentation =
    selectedBlock === undefined
      ? undefined
      : getAgentBlockPresentation(workflow, selectedBlock.id);
  const selectedMetadataIssue =
    selectedBlock === undefined
      ? undefined
      : getAgentBlockMetadataIssue(workflow, selectedBlock.id);
  const selectedComputerUsePresentation =
    selectedBlock === undefined
      ? undefined
      : getComputerUseBlockPresentation(workflow, selectedBlock.id);
  const selectedComputerUseMetadataIssue =
    selectedBlock === undefined
      ? undefined
      : getComputerUseBlockMetadataIssue(workflow, selectedBlock.id);
  const runInputBuild = useMemo(
    () => buildWorkflowRunInputs(workflow, runInputValues),
    [runInputValues, workflow],
  );
  const isRunning = activeRunId !== undefined && runOutcome === undefined;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const selectFilesystemPath = useCallback(
    async (
      kind: 'file' | 'directory' | 'output-file',
      defaultPath?: string,
    ): Promise<string | undefined> => {
      const result = await window.vorkflo.selectFilesystemPath({
        kind,
        ...(defaultPath === undefined ? {} : { defaultPath }),
      });
      return result.canceled ? undefined : result.path;
    },
    [],
  );

  const openArtifact = useCallback(async (path: string): Promise<void> => {
    try {
      await window.vorkflo.openFilesystemPath(path);
      setNotice(`Opened ${fileName(path)} in the default editor.`);
    } catch (error) {
      setNotice(`Could not open file: ${errorMessage(error)}`);
    }
  }, []);

  const refreshRunHistory = useCallback(async (): Promise<void> => {
    try {
      setRunHistory(await window.vorkflo.listRunHistory(workflow.id));
    } catch (error) {
      setNotice(`Could not load run history: ${errorMessage(error)}`);
    }
  }, [workflow.id]);

  const changeWorkflow = useCallback(
    (update: (current: WorkflowDefinition) => WorkflowDefinition) => {
      setHistory((current) =>
        pushWorkflowHistory(current, update(current.present)),
      );
      setDirty(true);
      setNotice(undefined);
    },
    [],
  );

  const resetCanvasWorkflow = useCallback((next: WorkflowDefinition): void => {
    setNodes(reconcileProcessNodes(next, [], () => 'idle'));
    setHistory(createWorkflowHistory(next));
    setCanvasRevision((revision) => revision + 1);
  }, []);

  const restoreHistory = useCallback(
    (next: WorkflowHistory): void => {
      setHistory(next);
      setNodes(
        reconcileProcessNodes(
          next.present,
          [],
          (blockId) => snapshots[blockId]?.state ?? 'idle',
        ),
      );
      setCanvasRevision((revision) => revision + 1);
      setDirty(historyBaselineDirty || next.past.length > 0);
      setNotice(undefined);
    },
    [historyBaselineDirty, snapshots],
  );

  const undo = useCallback((): void => {
    const next = undoWorkflowHistory(history);
    if (next !== history) restoreHistory(next);
  }, [history, restoreHistory]);

  const redo = useCallback((): void => {
    const next = redoWorkflowHistory(history);
    if (next !== history) restoreHistory(next);
  }, [history, restoreHistory]);

  const copyBlock = useCallback(
    (blockId: string): void => {
      const copied = copyProcessBlock(workflow, blockId);
      if (copied === undefined) return;
      setBlockClipboard(copied);
      setBlockClipboardPresentation(
        getAgentBlockPresentation(workflow, blockId) ??
          getComputerUseBlockPresentation(workflow, blockId),
      );
      setNotice(`Copied ${copied.block.name}.`);
    },
    [workflow],
  );

  const copySelectedBlock = useCallback((): void => {
    copyBlock(selectedBlockId);
  }, [copyBlock, selectedBlockId]);

  const getPastePosition = useCallback(() => {
    const reactFlow = reactFlowInstanceRef.current;
    if (reactFlow === null) return undefined;
    if (lastCanvasPointerRef.current !== null) {
      return reactFlow.screenToFlowPosition(lastCanvasPointerRef.current);
    }
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const bounds = canvas.getBoundingClientRect();
    return reactFlow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  }, []);

  const pasteCopiedBlock = useCallback((): void => {
    if (blockClipboard === undefined) return;
    const position = getPastePosition();
    const pasted = pasteProcessBlock(
      workflow,
      blockClipboard,
      position === undefined ? {} : { position },
    );
    const nextWorkflow = (() => {
      if (blockClipboardPresentation === undefined) return pasted.workflow;
      if (blockClipboardPresentation.kind === 'computer-use') {
        return setComputerUseBlockPresentation(
          pasted.workflow,
          pasted.blockId,
          {
            ...blockClipboardPresentation.config,
            id: pasted.blockId,
            name: blockClipboard.block.name,
          },
        );
      }
      return setAgentBlockPresentation(
        pasted.workflow,
        pasted.blockId,
        blockClipboardPresentation.agentRuntime,
        blockClipboardPresentation.isolation,
      );
    })();
    setHistory(pushWorkflowHistory(history, nextWorkflow));
    setSelectedBlockId(pasted.blockId);
    setInspectorTab('configure');
    setDirty(true);
    setNotice(`Pasted ${blockClipboard.block.name}.`);
  }, [
    blockClipboard,
    blockClipboardPresentation,
    getPastePosition,
    history,
    workflow,
  ]);

  const nodeActions = useMemo(
    () => ({
      onCopy: copyBlock,
      onPaste: pasteCopiedBlock,
      pasteDisabled: blockClipboard === undefined,
    }),
    [blockClipboard, copyBlock, pasteCopiedBlock],
  );

  const autoArrange = useCallback((): void => {
    const arranged = autoArrangeWorkflow(workflow);
    setHistory(pushWorkflowHistory(history, arranged));
    // A layout change must preserve measured nodes and the mounted canvas.
    // Recreating React Flow here forces every node through initial measurement.
    setNodes((current) =>
      reconcileProcessNodes(
        arranged,
        current,
        (blockId) => snapshots[blockId]?.state ?? 'idle',
        { applyLayout: true },
      ),
    );
    requestAnimationFrame(() => {
      void reactFlowInstanceRef.current?.fitView({ padding: 0.28, maxZoom: 1 });
    });
    setDirty(true);
    setNotice('Workflow arranged.');
  }, [history, snapshots, workflow]);

  useEffect(() => {
    let active = true;
    void window.vorkflo
      .getUserModelCatalog()
      .then((result) => {
        if (!active) return;
        setUserModelCatalog(result);
        if (result.issue !== undefined) setNotice(result.issue);
      })
      .catch((error: unknown) => {
        if (active)
          setNotice(`Could not load model settings: ${errorMessage(error)}`);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return window.vorkflo.onRunEvent((event: DesktopRunEvent) => {
      if (event.type === 'run_started') {
        setActiveRunId(event.runId);
        setRunOutcome(undefined);
        setSnapshots(
          Object.fromEntries(
            event.blocks.map((block) => [block.blockId, block]),
          ),
        );
      }
      if (event.type === 'block_updated') {
        setSnapshots((current) => ({
          ...current,
          [event.block.blockId]: event.block,
        }));
      }
      if (event.type === 'run_completed') {
        setRunOutcome(event.outcome);
        setNotice(
          event.error === undefined
            ? `Run ${event.outcome}.`
            : `${event.error.message} ${event.error.nextAction}`,
        );
        void refreshRunHistory();
      }
    });
  }, [refreshRunHistory]);

  useEffect(() => {
    void refreshRunHistory();
  }, [refreshRunHistory]);

  useEffect(() => {
    let active = true;
    setPreflightLoading(true);
    void window.vorkflo
      .preflightWorkflow({
        runId: plannedRunId,
        workflow,
        runInputs: runInputBuild.inputs,
        ...(filePath === undefined ? {} : { workflowFilePath: filePath }),
      })
      .then((result) => {
        if (active) setPreflight(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setPreflight(undefined);
          setNotice(`Preflight failed: ${errorMessage(error)}`);
        }
      })
      .finally(() => {
        if (active) setPreflightLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filePath, plannedRunId, runInputBuild.inputs, workflow]);

  useEffect(() => {
    if (dirty) {
      writeWorkflowDraft({
        workflow,
        ...(filePath === undefined ? {} : { filePath }),
      });
    } else {
      clearWorkflowDraft();
    }
  }, [dirty, filePath, workflow]);

  useEffect(() => {
    if (
      selectedBlockId !== '' &&
      !workflow.blocks.some((block) => block.id === selectedBlockId)
    ) {
      setSelectedBlockId(workflow.blocks[0]?.id ?? '');
    }
  }, [selectedBlockId, workflow.blocks]);

  useEffect(() => {
    if (
      inspectorFocusRequest === undefined ||
      inspectorTab !== 'configure' ||
      selectedBlockId !== inspectorFocusRequest.blockId
    ) {
      return;
    }
    const animationFrame = requestAnimationFrame(() => {
      const fields = document
        .querySelector<HTMLElement>('.inspector')
        ?.querySelectorAll<HTMLElement>('[data-inspector-field]');
      const target =
        fields === undefined
          ? undefined
          : [...fields].find((candidate) =>
              inspectorFieldMatches(
                candidate.dataset.inspectorField,
                inspectorFocusRequest.field,
              ),
            );
      target?.focus();
      target?.scrollIntoView?.({ block: 'center' });
      setInspectorFocusRequest(undefined);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [inspectorFocusRequest, inspectorTab, selectedBlockId]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        void saveWorkflow(event.shiftKey);
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        void openWorkflow();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (key === 'c') {
        event.preventDefault();
        copySelectedBlock();
      }
      if (key === 'v') {
        event.preventDefault();
        pasteCopiedBlock();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [copySelectedBlock, pasteCopiedBlock, redo, undo]);

  useEffect(() => {
    setNodes((current) =>
      reconcileProcessNodes(
        workflow,
        current,
        (blockId) => snapshots[blockId]?.state ?? 'idle',
      ).map((node) => {
        const selected = node.id === selectedBlockId;
        return node.selected === selected ? node : { ...node, selected };
      }),
    );
  }, [selectedBlockId, snapshots, workflow]);

  const edges = useMemo<ArtifactFlowEdge[]>(
    () =>
      workflow.connections.map((connection) => {
        const artifact = findRoutedFileArtifact(
          snapshots[connection.from.blockId]?.artifacts ?? [],
          connection.from.portId,
        );
        const sourcePort = workflow.blocks
          .find((block) => block.id === connection.from.blockId)
          ?.outputs.find((port) => port.id === connection.from.portId);
        return {
          id: connection.id,
          source: connection.from.blockId,
          sourceHandle: connection.from.portId,
          target: connection.to.blockId,
          targetHandle: connection.to.portId,
          type: 'artifact',
          animated:
            snapshots[connection.from.blockId]?.state === 'running' ||
            snapshots[connection.to.blockId]?.state === 'running',
          style: { stroke: '#67768d', strokeWidth: 1.5 },
          data:
            artifact === undefined
              ? {}
              : {
                  filePath: artifact.path,
                  fileLabel: sourcePort?.name ?? connection.from.portId,
                  onOpenFile: (path: string) => void openArtifact(path),
                },
        };
      }),
    [openArtifact, snapshots, workflow.blocks, workflow.connections],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<ProcessFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      const removedIds = new Set(
        changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      if (removedIds.size > 0) {
        changeWorkflow((current) =>
          [...removedIds].reduce(removeEditorBlock, current),
        );
        if (removedIds.has(selectedBlockId)) setSelectedBlockId('');
      }

      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          setSelectedBlockId(change.id);
          break;
        }
      }
    },
    [changeWorkflow, selectedBlockId],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<ProcessFlowNode>>(
    (_event, node) => {
      changeWorkflow((current) =>
        setBlockPosition(current, node.id, node.position),
      );
    },
    [changeWorkflow],
  );

  const onCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.react-flow__node-toolbar') !== null
      ) {
        return;
      }
      const reactFlow = reactFlowInstanceRef.current;
      if (reactFlow === null) return;
      lastCanvasPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(
        changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      if (removed.size > 0) {
        changeWorkflow((current) => ({
          ...current,
          connections: current.connections.filter(
            (connection) => !removed.has(connection.id),
          ),
        }));
      }
    },
    [changeWorkflow],
  );

  const onConnect = useCallback(
    (connection: FlowConnection) => {
      if (
        connection.source === null ||
        connection.sourceHandle === null ||
        connection.target === null ||
        connection.targetHandle === null
      ) {
        return;
      }
      changeWorkflow((current) =>
        connectBlocks(
          current,
          connection.source!,
          connection.sourceHandle!,
          connection.target!,
          connection.targetHandle!,
        ),
      );
    },
    [changeWorkflow],
  );

  const addBlock = (): void => {
    const block = createProcessBlock();
    changeWorkflow((current) => ({
      ...current,
      blocks: [...current.blocks, block],
      layout: {
        blockPositions: {
          ...(current.layout?.blockPositions ?? {}),
          [block.id]: {
            x: 180 + (current.blocks.length % 3) * 300,
            y: 160 + Math.floor(current.blocks.length / 3) * 220,
          },
        },
      },
    }));
    setSelectedBlockId(block.id);
    setInspectorVisible(true);
    setInspectorTab('configure');
  };

  const addAgentBlock = (): void => {
    const block = compileAgentBlock({
      id: crypto.randomUUID(),
      name: 'AI Agent',
      agentRuntime: 'codex',
      instruction: 'Complete the requested task and return a concise response.',
      ...(userModelCatalog?.catalog.codex.default === undefined
        ? {}
        : { model: userModelCatalog.catalog.codex.default }),
      authority: 'read-only',
      textContext: { portId: 'context', name: 'Context' },
      textResponse: { portId: 'response', name: 'Response' },
      filesystemOutputs: [],
      isolation: { mode: 'current-directory' },
    });
    changeWorkflow((current) =>
      setAgentBlockPresentation(
        {
          ...current,
          blocks: [...current.blocks, block],
          layout: {
            blockPositions: {
              ...(current.layout?.blockPositions ?? {}),
              [block.id]: {
                x: 180 + (current.blocks.length % 3) * 300,
                y: 160 + Math.floor(current.blocks.length / 3) * 220,
              },
            },
          },
        },
        block.id,
        'codex',
        { mode: 'current-directory' },
      ),
    );
    setSelectedBlockId(block.id);
    setInspectorVisible(true);
    setInspectorTab('configure');
  };

  const addComputerUseBlock = (): void => {
    const id = crypto.randomUUID();
    const config = createDefaultComputerUseConfig({
      id,
      ...(userModelCatalog?.catalog.codex.default === undefined
        ? {}
        : { model: userModelCatalog.catalog.codex.default }),
    });
    const block = compileComputerUseBlock(config);
    changeWorkflow((current) =>
      setComputerUseBlockPresentation(
        {
          ...current,
          blocks: [...current.blocks, block],
          layout: {
            blockPositions: {
              ...(current.layout?.blockPositions ?? {}),
              [id]: {
                x: 180 + (current.blocks.length % 3) * 300,
                y: 160 + Math.floor(current.blocks.length / 3) * 220,
              },
            },
          },
        },
        id,
        config,
      ),
    );
    setSelectedBlockId(id);
    setInspectorVisible(true);
    setInspectorTab('configure');
  };

  async function saveWorkflow(saveAs = false): Promise<void> {
    try {
      const result = await window.vorkflo.saveWorkflow({
        workflow,
        ...(filePath === undefined ? {} : { filePath }),
        ...(saveAs ? { saveAs: true } : {}),
      });
      if (!result.canceled) {
        setFilePath(result.filePath);
        setHistory(createWorkflowHistory(workflow));
        setHistoryBaselineDirty(false);
        setDirty(false);
        clearWorkflowDraft();
        setNotice('Workflow saved.');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function openWorkflow(): Promise<void> {
    if (
      dirty &&
      !window.confirm('Discard unsaved changes and open a workflow?')
    ) {
      return;
    }
    try {
      const result = await window.vorkflo.openWorkflow();
      if (result.canceled || result.workflow === undefined) return;
      const normalized = normalizeAgentRuntimeWorkflow(result.workflow);
      resetCanvasWorkflow(normalized.workflow);
      setFilePath(result.filePath);
      setHistoryBaselineDirty(normalized.migratedBlockIds.length > 0);
      setDirty(normalized.migratedBlockIds.length > 0);
      clearWorkflowDraft();
      setSnapshots({});
      setRunOutcome(undefined);
      setActiveRunId(undefined);
      setBlockClipboard(undefined);
      setBlockClipboardPresentation(undefined);
      setRunInputValues({});
      setSelectedRunId(undefined);
      setSelectedBlockId(normalized.workflow.blocks[0]?.id ?? '');
      setNotice(
        normalized.migratedBlockIds.length > 0
          ? 'Workflow opened. Updated legacy Cline context delivery; save to keep the repair.'
          : 'Workflow opened.',
      );
    } catch (error) {
      setNotice(`Could not open workflow: ${errorMessage(error)}`);
    }
  }

  function newWorkflow(): void {
    if (
      dirty &&
      !window.confirm('Discard unsaved changes and create a workflow?')
    ) {
      return;
    }
    const next = createWorkflow();
    resetCanvasWorkflow(next);
    setFilePath(undefined);
    setHistoryBaselineDirty(false);
    setDirty(false);
    clearWorkflowDraft();
    setSnapshots({});
    setRunOutcome(undefined);
    setActiveRunId(undefined);
    setBlockClipboard(undefined);
    setBlockClipboardPresentation(undefined);
    setRunInputValues({});
    setSelectedRunId(undefined);
    setSelectedBlockId(next.blocks[0]?.id ?? '');
    setNotice('New workflow created.');
  }

  async function startRun(): Promise<void> {
    if (
      !validation.valid ||
      !runInputBuild.valid ||
      preflight?.ready !== true ||
      !trustConfirmed
    )
      return;
    try {
      setSnapshots({});
      setRunOutcome(undefined);
      setSelectedRunId(undefined);
      const result = await window.vorkflo.runWorkflow({
        runId: plannedRunId,
        workflow,
        runInputs: runInputBuild.inputs,
        ...(filePath === undefined ? {} : { workflowFilePath: filePath }),
      });
      setActiveRunId(result.runId);
      setPlannedRunId(crypto.randomUUID());
      setRunPreviewOpen(false);
      setTrustConfirmed(false);
      setInspectorTab('run');
    } catch (error) {
      setNotice(`Could not start run: ${errorMessage(error)}`);
    }
  }

  async function cancelRun(): Promise<void> {
    if (activeRunId !== undefined) await window.vorkflo.cancelRun(activeRunId);
  }

  async function copyToClipboard(value: string, label: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error('Clipboard access is unavailable.');
      }
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch (error) {
      setNotice(`Could not copy ${label}: ${errorMessage(error)}`);
    }
  }

  async function revealArtifact(path: string): Promise<void> {
    await window.vorkflo.revealFilesystemPath(path);
    setNotice('Revealed filesystem reference in Finder.');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={18} />
          </div>
          <span>Vorkflo</span>
          <em>v{__VORKFLO_VERSION__}</em>
        </div>
        <div className="document-title">
          <input
            aria-label="Workflow name"
            value={workflow.name}
            onChange={(event) =>
              changeWorkflow((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
          <small title={filePath}>
            <span className={`document-state ${dirty ? 'unsaved' : ''}`} />
            {filePath === undefined
              ? 'Unsaved workflow'
              : `${fileName(filePath)}${dirty ? ' · Unsaved changes' : ' · Saved'}`}
          </small>
        </div>
        <div className="toolbar">
          <ToolbarButton
            icon={<FileCode2 size={15} />}
            label="New"
            onClick={newWorkflow}
          />
          <ToolbarButton
            icon={<FolderOpen size={15} />}
            label="Open"
            onClick={() => void openWorkflow()}
          />
          <ToolbarButton
            icon={<Save size={15} />}
            label="Save"
            onClick={() => void saveWorkflow()}
          />
          <ToolbarButton
            icon={<SaveAll size={15} />}
            label="Save As"
            onClick={() => void saveWorkflow(true)}
          />
          <span className="toolbar-separator" />
          <ToolbarButton
            icon={<Undo2 size={15} />}
            label="Undo"
            title="Undo (Cmd/Ctrl-Z)"
            disabled={!canUndo}
            onClick={undo}
          />
          <ToolbarButton
            icon={<Redo2 size={15} />}
            label="Redo"
            title="Redo (Cmd/Ctrl-Shift-Z)"
            disabled={!canRedo}
            onClick={redo}
          />
          <span className="toolbar-separator" />
          {isRunning ? (
            <button className="button danger" onClick={() => void cancelRun()}>
              <CircleStop size={15} /> Cancel
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => setRunPreviewOpen(true)}
              disabled={!validation.valid}
              title={
                validation.valid
                  ? 'Review and run'
                  : 'Resolve validation issues first'
              }
            >
              <Play size={15} fill="currentColor" /> Review & Run
            </button>
          )}
        </div>
      </header>

      <section
        className={`workspace ${libraryVisible ? '' : 'library-hidden'} ${inspectorVisible ? '' : 'inspector-hidden'}`}
      >
        <aside
          id="block-library"
          className="rail"
          aria-label="Block library"
          hidden={!libraryVisible}
        >
          <div className="library-header">
            <small>BLOCK LIBRARY</small>
            <h1>Make it flow.</h1>
            <p>Add a block. Connect your tools.</p>
          </div>
          <button
            className="add-process"
            aria-label="Add process"
            onClick={addBlock}
          >
            <span>
              <TerminalSquare size={17} />
            </span>
            <span>
              <strong>Process</strong>
              <small>Generic local command</small>
            </span>
            <Plus size={15} />
          </button>
          <button
            className="add-process add-agent"
            aria-label="Add AI Agent"
            onClick={addAgentBlock}
          >
            <span>
              <Bot size={17} />
            </span>
            <span>
              <strong>AI Agent</strong>
              <small>Your local AI tools</small>
            </span>
            <Plus size={15} />
          </button>
          <button
            className="add-process add-computer-use"
            aria-label="Add Computer Use"
            onClick={addComputerUseBlock}
          >
            <span>
              <MonitorUp size={17} />
            </span>
            <span>
              <strong>Computer Use</strong>
              <small>Bounded browser automation</small>
            </span>
            <Plus size={15} />
          </button>
          <div className="rail-heading">WORKFLOW</div>
          <div className="workflow-stat">
            <GitBranch size={15} />
            <span>
              {workflow.blocks.length}{' '}
              {workflow.blocks.length === 1 ? 'block' : 'blocks'}
            </span>
            <span>
              {workflow.connections.length}{' '}
              {workflow.connections.length === 1 ? 'link' : 'links'}
            </span>
          </div>
          <div
            className={`validation-summary ${validation.valid ? 'valid' : 'invalid'}`}
          >
            {validation.valid ? (
              <Check size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <div>
              <strong>
                {validation.valid
                  ? 'Graph is valid'
                  : `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}`}
              </strong>
              <small>
                {validation.valid
                  ? 'Review your commands before running'
                  : 'Execution is blocked'}
              </small>
            </div>
          </div>
          {!validation.valid && (
            <div className="issues-list">
              {validation.issues.map((issue, index) => (
                <button
                  key={`${issue.path}-${index}`}
                  onClick={() => selectIssueBlock(issue.path)}
                >
                  <XCircle size={13} />
                  <span>
                    {issue.message}
                    <small>{issue.path}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <WorkflowInputsEditor
            workflow={workflow}
            onChange={(next) => changeWorkflow(() => next)}
            selectPath={selectFilesystemPath}
          />
          <RunHistoryPanel
            records={runHistory}
            {...(selectedRunId === undefined ? {} : { selectedRunId })}
            onSelect={(record) => {
              setSnapshots(
                Object.fromEntries(
                  record.blocks.map((block) => [block.blockId, block]),
                ),
              );
              setActiveRunId(record.runId);
              setRunOutcome(record.outcome);
              setSelectedRunId(record.runId);
              setRunInputValues(serializedHistoryInputs(record.runInputs));
              const focusBlock =
                record.blocks.find((block) => block.state === 'failed') ??
                record.blocks[0];
              if (focusBlock !== undefined) {
                setInspectorVisible(true);
                setSelectedBlockId(focusBlock.blockId);
                setInspectorTab('run');
              }
              setNotice(`Viewing retained run ${record.runId}.`);
            }}
            onReveal={(path) => void revealArtifact(path)}
            onWorktreeChanged={() => void refreshRunHistory()}
            onClear={() => {
              void window.vorkflo
                .clearRunHistory(workflow.id)
                .then(() => {
                  setRunHistory([]);
                  setSelectedRunId(undefined);
                  setNotice('Run history cleared.');
                })
                .catch((error: unknown) =>
                  setNotice(`Could not clear history: ${errorMessage(error)}`),
                );
            }}
          />
          <div className="rail-footer">
            <ShieldAlert size={14} />
            <span>Commands run with your local user permissions.</span>
          </div>
        </aside>

        <section
          ref={canvasRef}
          className="canvas"
          aria-label="Workflow canvas"
          onPointerMove={onCanvasPointerMove}
        >
          <div className="canvas-toolbar">
            <button
              className="icon-button panel-toggle"
              aria-label={
                libraryVisible ? 'Hide block library' : 'Show block library'
              }
              aria-expanded={libraryVisible}
              aria-controls="block-library"
              title={
                libraryVisible ? 'Hide block library' : 'Show block library'
              }
              onClick={() => setLibraryVisible((visible) => !visible)}
            >
              <PanelLeft size={17} />
            </button>
            <div className="canvas-label">
              <Network size={14} />
              <span>Workflow</span>
              <ChevronRight size={12} />
              <span>{workflow.name}</span>
            </div>
            <button
              className="icon-button panel-toggle"
              aria-label={
                inspectorVisible ? 'Hide inspector' : 'Show inspector'
              }
              aria-expanded={inspectorVisible}
              aria-controls="block-inspector"
              title={inspectorVisible ? 'Hide inspector' : 'Show inspector'}
              onClick={() => setInspectorVisible((visible) => !visible)}
            >
              <PanelRight size={17} />
            </button>
          </div>
          <ProcessNodeActionsProvider value={nodeActions}>
            <ReactFlow
              key={canvasRevision}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(instance) => {
                reactFlowInstanceRef.current = instance;
              }}
              onNodesChange={onNodesChange}
              onNodeDragStop={onNodeDragStop}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={() => setSelectedBlockId('')}
              onNodeClick={(_, node) => {
                setSelectedBlockId(node.id);
                setInspectorVisible(true);
              }}
              fitView
              fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
              minZoom={0.25}
              maxZoom={1.8}
              deleteKeyCode={['Backspace', 'Delete']}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="#30323e"
              />
              <MiniMap
                className="minimap"
                pannable
                zoomable
                maskColor="rgba(12, 13, 19, .65)"
                nodeStrokeColor="#b8b2ce"
                nodeStrokeWidth={1.5}
                nodeColor={(node) =>
                  statusColor(snapshots[node.id]?.state ?? 'idle')
                }
              />
              <Controls
                className="flow-controls"
                aria-label="Canvas controls"
                showInteractive={false}
              >
                <ControlButton
                  aria-label="Auto arrange"
                  title="Arrange workflow by dependency layer"
                  disabled={workflow.blocks.length === 0}
                  onClick={autoArrange}
                >
                  <Network size={14} />
                </ControlButton>
              </Controls>
            </ReactFlow>
          </ProcessNodeActionsProvider>
          {workflow.blocks.length === 0 && (
            <div className="empty-canvas">
              <TerminalSquare size={28} />
              <strong>Add your first process</strong>
              <span>
                Build from generic local commands, then connect their typed
                ports.
              </span>
              <button className="button primary" onClick={addBlock}>
                <Plus size={14} /> Add process
              </button>
            </div>
          )}
          <div className="canvas-hint" aria-hidden="true">
            Drag to connect <span>·</span> Scroll to zoom
          </div>
        </section>

        <aside
          id="block-inspector"
          className="inspector"
          aria-label="Block inspector"
          hidden={!inspectorVisible}
        >
          {selectedBlock === undefined ? (
            <div className="no-selection">
              <PanelRightClose size={24} />
              <strong>No block selected</strong>
              <span>
                Select a process on the canvas to configure or inspect it.
              </span>
            </div>
          ) : (
            <>
              <div className="inspector-header">
                <div>
                  <small>
                    {selectedComputerUsePresentation !== undefined
                      ? 'COMPUTER USE BLOCK'
                      : selectedPresentation === undefined
                        ? 'PROCESS BLOCK'
                        : 'AI AGENT BLOCK'}
                  </small>
                  <strong>{selectedBlock.name}</strong>
                </div>
                <button
                  className="icon-button destructive"
                  title="Delete block"
                  aria-label="Delete block"
                  onClick={() => {
                    changeWorkflow((current) =>
                      removeEditorBlock(current, selectedBlock.id),
                    );
                    setSelectedBlockId('');
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="tab-list" role="tablist">
                <button
                  id="inspector-configure-tab"
                  role="tab"
                  aria-selected={inspectorTab === 'configure'}
                  aria-controls="inspector-configure-panel"
                  tabIndex={inspectorTab === 'configure' ? 0 : -1}
                  className={inspectorTab === 'configure' ? 'active' : ''}
                  onClick={() => setInspectorTab('configure')}
                  onKeyDown={(event) =>
                    handleInspectorTabKeyDown(
                      event,
                      'configure',
                      setInspectorTab,
                    )
                  }
                >
                  Configure
                </button>
                <button
                  id="inspector-run-tab"
                  role="tab"
                  aria-selected={inspectorTab === 'run'}
                  aria-controls="inspector-run-panel"
                  tabIndex={inspectorTab === 'run' ? 0 : -1}
                  className={inspectorTab === 'run' ? 'active' : ''}
                  onClick={() => setInspectorTab('run')}
                  onKeyDown={(event) =>
                    handleInspectorTabKeyDown(event, 'run', setInspectorTab)
                  }
                >
                  Run details
                  {snapshots[selectedBlock.id] && (
                    <span
                      className={`tiny-dot ${snapshots[selectedBlock.id]?.state}`}
                    />
                  )}
                </button>
              </div>
              <div
                id={
                  inspectorTab === 'configure'
                    ? 'inspector-configure-panel'
                    : 'inspector-run-panel'
                }
                className="inspector-tab-panel"
                role="tabpanel"
                aria-labelledby={
                  inspectorTab === 'configure'
                    ? 'inspector-configure-tab'
                    : 'inspector-run-tab'
                }
              >
                {inspectorTab === 'configure' ? (
                  selectedComputerUsePresentation !== undefined ? (
                    <ComputerUseBlockInspector
                      block={selectedBlock}
                      presentation={selectedComputerUsePresentation}
                      selectPath={selectFilesystemPath}
                      onChange={(block, presentation) =>
                        changeWorkflow((current) =>
                          setComputerUseBlockPresentation(
                            replaceBlock(current, block),
                            block.id,
                            presentation.config,
                          ),
                        )
                      }
                    />
                  ) : selectedPresentation === undefined ? (
                    selectedMetadataIssue?.code === 'runtime-unsupported' ? (
                      <UnsupportedAgentRuntimeInspector
                        issue={selectedMetadataIssue}
                        onChoose={(agentRuntime) =>
                          changeWorkflow((current) =>
                            setAgentBlockPresentation(
                              replaceBlock(
                                current,
                                compileAgentBlock(
                                  agentEditorConfigFromBlock(selectedBlock, {
                                    kind: 'ai-agent',
                                    agentRuntime,
                                    isolation: {
                                      mode: 'current-directory',
                                    },
                                  }),
                                ),
                              ),
                              selectedBlock.id,
                              agentRuntime,
                              { mode: 'current-directory' },
                            ),
                          )
                        }
                        onTreatAsProcess={() =>
                          changeWorkflow((current) =>
                            removeBlockPresentation(current, selectedBlock.id),
                          )
                        }
                      />
                    ) : (
                      <>
                        {selectedComputerUseMetadataIssue !== undefined && (
                          <div className="inline-notice error">
                            {selectedComputerUseMetadataIssue.message}
                          </div>
                        )}
                        <ProcessBlockInspector
                          block={selectedBlock}
                          workflow={workflow}
                          {...(preflight?.blocks.find(
                            (block) => block.blockId === selectedBlock.id,
                          ) === undefined
                            ? {}
                            : {
                                resolved: preflight.blocks.find(
                                  (block) => block.blockId === selectedBlock.id,
                                )!,
                              })}
                          selectPath={selectFilesystemPath}
                          onChange={(block) =>
                            changeWorkflow((current) =>
                              replaceBlock(current, block),
                            )
                          }
                          onWorkflowChange={(next) =>
                            changeWorkflow(() => next)
                          }
                        />
                      </>
                    )
                  ) : (
                    <AgentBlockInspector
                      block={selectedBlock}
                      presentation={selectedPresentation}
                      selectPath={selectFilesystemPath}
                      {...(userModelCatalog === undefined
                        ? {}
                        : {
                            modelCatalog: userModelCatalog.catalog,
                            modelCatalogPath: userModelCatalog.filePath,
                          })}
                      onChange={(block, presentation) =>
                        changeWorkflow((current) =>
                          setAgentBlockPresentation(
                            replaceBlock(current, block),
                            block.id,
                            presentation.agentRuntime,
                            presentation.isolation,
                          ),
                        )
                      }
                    />
                  )
                ) : (
                  <RunInspector
                    {...(snapshots[selectedBlock.id] === undefined
                      ? {}
                      : { snapshot: snapshots[selectedBlock.id] })}
                    {...(selectedPresentation?.agentRuntime === undefined
                      ? {}
                      : { agentRuntime: selectedPresentation.agentRuntime })}
                    onCopy={(value, label) =>
                      void copyToClipboard(value, label)
                    }
                    onReveal={(path) => void revealArtifact(path)}
                    onNavigateFailure={(failure) => {
                      const field = runtimeFailureInspectorField(
                        failure.code,
                        selectedPresentation !== undefined,
                      );
                      navigateToInspectorField(selectedBlock.id, field);
                      setNotice(`Review ${field} for ${failure.code}.`);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span
          className={`run-indicator ${isRunning ? 'running' : (runOutcome ?? 'idle')}`}
        >
          {isRunning ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <span className="status-led" />
          )}
          {isRunning
            ? 'Execution active'
            : runOutcome
              ? `Last run: ${runOutcome}`
              : 'Ready when you are'}
        </span>
        {notice && (
          <span className="notice" role="status" aria-live="polite">
            {notice}
          </span>
        )}
        <span className="status-spacer" />
        <span className="status-schema">Schema v{workflow.schemaVersion}</span>
        <span className="local-status">
          <span className="status-led" /> Local execution
        </span>
      </footer>

      {runPreviewOpen && (
        <RunPreview
          workflow={workflow}
          valid={
            validation.valid && runInputBuild.valid && preflight?.ready === true
          }
          inputValues={runInputValues}
          inputErrors={runInputBuild.errors}
          onInputChange={(inputId, value) =>
            setRunInputValues((current) => ({
              ...current,
              [inputId]: value,
            }))
          }
          selectPath={selectFilesystemPath}
          {...(preflight === undefined ? {} : { preflight })}
          preflightLoading={preflightLoading}
          onSelectIssue={(blockId, field) => {
            if (blockId === undefined && field.startsWith('runInputs.')) {
              const inputId = field.slice('runInputs.'.length);
              requestAnimationFrame(() => {
                const field = [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-run-input-id]',
                  ),
                ].find((candidate) => candidate.dataset.runInputId === inputId);
                field?.focus();
              });
              setNotice(`Provide run input ${inputId}.`);
              return;
            }
            if (blockId !== undefined) {
              const agent = getAgentBlockPresentation(workflow, blockId);
              navigateToInspectorField(
                blockId,
                agent !== undefined && field === 'invocation.executable'
                  ? 'editor.agentRuntime'
                  : field,
              );
            }
            setRunPreviewOpen(false);
            setTrustConfirmed(false);
            setNotice(`Review ${field}.`);
          }}
          trustConfirmed={trustConfirmed}
          onTrustChange={setTrustConfirmed}
          onClose={() => {
            setRunPreviewOpen(false);
            setTrustConfirmed(false);
          }}
          onRun={() => void startRun()}
        />
      )}
    </main>
  );

  function selectIssueBlock(path: string): void {
    const blockMatch = /blocks\[(\d+)\](?:\.(.*))?/.exec(path);
    const index =
      blockMatch?.[1] === undefined ? undefined : Number(blockMatch[1]);
    const block = index === undefined ? undefined : workflow.blocks[index];
    if (block !== undefined) {
      navigateToInspectorField(block.id, blockMatch?.[2] ?? 'block');
      return;
    }
    const connectionMatch = /connections\[(\d+)\]/.exec(path);
    const connectionIndex =
      connectionMatch?.[1] === undefined
        ? undefined
        : Number(connectionMatch[1]);
    const connection =
      connectionIndex === undefined
        ? undefined
        : workflow.connections[connectionIndex];
    if (connection !== undefined) {
      navigateToInspectorField(connection.to.blockId, 'inputs');
    }
  }

  function navigateToInspectorField(blockId: string, field: string): void {
    setInspectorVisible(true);
    setSelectedBlockId(blockId);
    setInspectorTab('configure');
    setInspectorFocusRequest({ blockId, field, nonce: Date.now() });
  }
}

function inspectorFieldMatches(
  candidate: string | undefined,
  requested: string,
): boolean {
  if (candidate === undefined) return false;
  const normalizedRequested = requested.replace(/^blocks\[\d+]\./, '');
  if (candidate === normalizedRequested) return true;
  if (
    candidate.startsWith(`${normalizedRequested}.`) ||
    normalizedRequested.startsWith(`${candidate}.`)
  ) {
    return true;
  }
  if (/^invocation\.arguments(?:\[\d+])?/.test(normalizedRequested)) {
    return candidate.startsWith('invocation.arguments');
  }
  if (/^invocation\.outputs(?:\[\d+])?/.test(normalizedRequested)) {
    return candidate.startsWith('invocation.outputs');
  }
  return false;
}

function handleInspectorTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: InspectorTab,
  onChange: (tab: InspectorTab) => void,
): void {
  let next: InspectorTab | undefined;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    next = current === 'configure' ? 'run' : 'configure';
  } else if (event.key === 'Home') {
    next = 'configure';
  } else if (event.key === 'End') {
    next = 'run';
  }
  if (next === undefined) return;
  event.preventDefault();
  onChange(next);
  const tabId =
    next === 'configure' ? 'inspector-configure-tab' : 'inspector-run-tab';
  requestAnimationFrame(() => document.getElementById(tabId)?.focus());
}

function UnsupportedAgentRuntimeInspector({
  issue,
  onChoose,
  onTreatAsProcess,
}: {
  issue: AgentBlockMetadataIssue;
  onChoose: (runtime: AgentRuntimeId) => void;
  onTreatAsProcess: () => void;
}) {
  const [runtime, setRuntime] = useState<AgentRuntimeId>('codex');
  return (
    <div className="inspector-scroll">
      <section className="inspector-section">
        <header>
          <span>Unsupported Agent runtime</span>
        </header>
        <div className="agent-authority-warning">
          <AlertTriangle size={14} />
          <span>{issue.message}</span>
        </div>
        <label className="field">
          <span>Replacement runtime</span>
          <select
            data-inspector-field="editor.agentRuntime"
            aria-label="Replacement Agent runtime"
            value={runtime}
            onChange={(event) =>
              setRuntime(event.target.value as AgentRuntimeId)
            }
          >
            {AGENT_RUNTIME_REGISTRY.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
          <small>
            The saved metadata is preserved until you explicitly choose how to
            recover this block.
          </small>
        </label>
        <div className="unsupported-agent-actions">
          <button className="button primary" onClick={() => onChoose(runtime)}>
            Use selected runtime
          </button>
          <button className="button" onClick={onTreatAsProcess}>
            Treat as generic process
          </button>
        </div>
      </section>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled = false,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className="toolbar-button"
      aria-label={label}
      data-tooltip={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function removeEditorBlock(
  workflow: WorkflowDefinition,
  blockId: string,
): WorkflowDefinition {
  return removeBlockPresentation(removeBlock(workflow, blockId), blockId);
}

function serializedHistoryInputs(
  inputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  try {
    const parsed: WorkflowRunInputs = parseWorkflowRunInputs(inputs);
    return Object.fromEntries(
      Object.entries(parsed).map(([inputId, value]) => [
        inputId,
        serializeRunInputValue(value),
      ]),
    );
  } catch {
    return {};
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runtimeFailureInspectorField(
  code: ExecutionFailure['code'],
  agentBlock: boolean,
): string {
  switch (code) {
    case 'executable_not_found':
    case 'process_launch_failed':
      return 'invocation.executable';
    case 'working_directory_not_found':
      return 'invocation.workingDirectory';
    case 'host_environment_variable_missing':
      return 'invocation.environment';
    case 'filesystem_reference_inaccessible':
    case 'invalid_json_output':
    case 'artifact_routing_failed':
      return 'invocation.outputs';
    case 'process_authentication_failed':
      return agentBlock ? 'editor.agentRuntime' : 'invocation.executable';
    case 'process_exit_nonzero':
    case 'process_timeout':
    case 'process_terminated_by_signal':
    case 'process_termination_failed':
      return 'invocation.arguments';
  }
}

function statusColor(state: BlockExecutionState | 'idle'): string {
  if (state === 'succeeded') return '#4cc38a';
  if (state === 'failed') return '#f06a6a';
  if (state === 'running') return '#e5b767';
  if (state === 'cancelled') return '#aa8df0';
  return '#526075';
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
