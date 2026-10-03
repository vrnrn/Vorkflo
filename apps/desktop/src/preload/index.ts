import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type DesktopRunEvent,
  type PreflightWorkflowRequest,
  type SaveWorkflowRequest,
  type SaveWorkflowResult,
  type RunHistoryRecord,
  type SelectFilesystemPathRequest,
  type SelectFilesystemPathResult,
  type VorkfloBridge,
  type UserModelCatalogResult,
  type WorkflowFileResult,
} from '../shared/contracts.js';

const bridge: VorkfloBridge = {
  getUserModelCatalog: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getUserModelCatalog,
    ) as Promise<UserModelCatalogResult>,
  openWorkflow: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.openWorkflow,
    ) as Promise<WorkflowFileResult>,
  saveWorkflow: (request: SaveWorkflowRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.saveWorkflow,
      request,
    ) as Promise<SaveWorkflowResult>,
  selectFilesystemPath: (request: SelectFilesystemPathRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.selectFilesystemPath,
      request,
    ) as Promise<SelectFilesystemPathResult>,
  openFilesystemPath: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openFilesystemPath, path) as Promise<void>,
  revealFilesystemPath: (path: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.revealFilesystemPath,
      path,
    ) as Promise<void>,
  listRunHistory: (workflowId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listRunHistory, workflowId) as Promise<
      readonly RunHistoryRecord[]
    >,
  clearRunHistory: (workflowId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.clearRunHistory,
      workflowId,
    ) as Promise<void>,
  inspectRunWorktree: (runId, scopeId) =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectRunWorktree, runId, scopeId),
  cleanupRunWorktree: (runId, scopeId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cleanupRunWorktree, runId, scopeId),
  preflightWorkflow: (request: PreflightWorkflowRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.preflightWorkflow, request),
  runWorkflow: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.runWorkflow, request) as Promise<{
      runId: string;
    }>,
  cancelRun: (runId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelRun, runId) as Promise<void>,
  onRunEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopRunEvent,
    ) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler);
  },
};

contextBridge.exposeInMainWorld('vorkflo', bridge);
