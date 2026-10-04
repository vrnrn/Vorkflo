import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { parseRunnableWorkflow } from '../shared/authority.js';
import {
  alignAgentRuntimeWorkingDirectories,
  applyUserModelDefaults,
  normalizeAgentRuntimeWorkflow,
} from '../shared/agent-runtime.js';
import {
  parseWorkflowDefinition,
  parseWorkflowRunInputs,
  preflightWorkflow,
  type WorkflowPreflightResult,
} from '@vorkflo/engine';
import { NodeWorkflowPreflight } from '@vorkflo/node-runner';
import {
  IPC_CHANNELS,
  type PreflightWorkflowRequest,
  type SaveWorkflowRequest,
  type SaveWorkflowResult,
  type SelectFilesystemPathRequest,
  type SelectFilesystemPathResult,
  type RunHistoryRecord,
  type RunWorkflowRequest,
  type WorkflowFileResult,
  type WorktreeRunRecord,
} from '../shared/contracts.js';
import {
  openFilesystemPath,
  revealFilesystemPath,
  selectFilesystemPath,
} from './path-actions.js';
import {
  applyDefaultWorkingDirectory,
  resolveDesktopWorkflowBaseDirectory,
  startWorkflowRun,
} from './runtime.js';
import { ActiveRunRegistry } from './run-registry.js';
import { RunHistoryStore } from './run-history.js';
import { readWorkflowFile, writeWorkflowFile } from './workflow-files.js';
import { applyApplicationIdentity } from './application-identity.js';
import { loadUserModelCatalog } from './model-catalog.js';
import { bindRuntimeHelpers } from './runtime-helpers.js';
import {
  applyAgentWorktreePreviews,
  finalizeAgentWorktrees,
  preflightAgentWorktrees,
  prepareAgentWorktrees,
} from './agent-worktrees.js';
import {
  WorktreeRuntime,
  WorktreeRuntimeError,
  type WorktreeScope,
} from './worktree-runtime.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const activeRuns = new ActiveRunRegistry();
const helperResourcesDirectory = app.isPackaged
  ? process.resourcesPath
  : resolve(currentDirectory, '../../resources');
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');
if (userDataOverride !== '') app.setPath('userData', resolve(userDataOverride));
applyApplicationIdentity(app);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Center native macOS controls in the renderer's 68px draggable header.
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 27 } }
      : {}),
    backgroundColor: '#0c0d13',
    show: false,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The editor never navigates into workflow content or grants a second window
  // its preload bridge. Native path actions remain explicit IPC operations.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const runHistory = new RunHistoryStore(
    join(app.getPath('userData'), 'run-history.json'),
  );
  registerIpc(runHistory);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeRuns.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(runHistory: RunHistoryStore): void {
  ipcMain.handle(IPC_CHANNELS.getUserModelCatalog, () =>
    loadUserModelCatalog(app.getPath('home')),
  );
  ipcMain.handle(
    IPC_CHANNELS.openWorkflow,
    async (): Promise<WorkflowFileResult> => {
      const selection = await dialog.showOpenDialog({
        title: 'Open workflow',
        properties: ['openFile'],
        filters: [
          { name: 'Vorkflo workflow', extensions: ['json', 'vorkflo'] },
        ],
      });
      const filePath = selection.filePaths[0];
      if (selection.canceled || filePath === undefined)
        return { canceled: true };
      const workflow = await readWorkflowFile(filePath);
      return { canceled: false, filePath, workflow };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.saveWorkflow,
    async (
      _event,
      request: SaveWorkflowRequest,
    ): Promise<SaveWorkflowResult> => {
      const workflow = request.workflow;
      let filePath = request.saveAs ? undefined : request.filePath;
      if (filePath === undefined) {
        const selection = await dialog.showSaveDialog({
          title: 'Save workflow',
          defaultPath: `${safeFileName(workflow.name)}.vorkflo.json`,
          filters: [
            {
              name: 'Vorkflo workflow',
              extensions: ['json'],
            },
          ],
        });
        if (selection.canceled || selection.filePath === undefined) {
          return { canceled: true };
        }
        filePath = selection.filePath;
      }

      await writeWorkflowFile(filePath, workflow);
      return { canceled: false, filePath };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.selectFilesystemPath,
    async (
      _event,
      request: SelectFilesystemPathRequest,
    ): Promise<SelectFilesystemPathResult> =>
      selectFilesystemPath(
        {
          showOpenDialog: (options) =>
            dialog.showOpenDialog({
              ...options,
              properties: [...options.properties],
            }),
          showSaveDialog: (options) => dialog.showSaveDialog(options),
        },
        request,
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.openFilesystemPath,
    (_event, path: string): Promise<void> => openFilesystemPath(shell, path),
  );

  ipcMain.handle(
    IPC_CHANNELS.revealFilesystemPath,
    (_event, path: string): void => revealFilesystemPath(shell, path),
  );

  ipcMain.handle(
    IPC_CHANNELS.listRunHistory,
    (_event, workflowId: string): Promise<readonly RunHistoryRecord[]> =>
      runHistory.list(workflowId),
  );

  ipcMain.handle(
    IPC_CHANNELS.clearRunHistory,
    (_event, workflowId: string): Promise<void> => runHistory.clear(workflowId),
  );

  ipcMain.handle(
    IPC_CHANNELS.inspectRunWorktree,
    async (_event, runId: string, scopeId: string) => {
      const located = await findRetainedWorktree(runHistory, runId, scopeId);
      return new WorktreeRuntime().inspect(
        worktreeScopeFromRecord(runId, located.worktree),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cleanupRunWorktree,
    async (_event, runId: string, scopeId: string) => {
      const located = await findRetainedWorktree(runHistory, runId, scopeId);
      const retainedArtifactPaths = located.record.blocks.flatMap((block) =>
        block.artifacts.flatMap((artifact) =>
          artifact.kind === 'filesystem-reference' ? [artifact.path] : [],
        ),
      );
      await new WorktreeRuntime().cleanup(
        worktreeScopeFromRecord(runId, located.worktree),
        { retainedArtifactPaths },
      );
      return runHistory.updateWorktree(runId, scopeId, (current) => ({
        ...current,
        state: 'cleaned',
        reason: 'safe-cleanup',
        status: '',
        hasChangesFromBase: false,
        nextAction:
          'The clean worktree and its run-scoped branch were removed.',
      }));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.preflightWorkflow,
    async (_event, input: unknown): Promise<WorkflowPreflightResult> => {
      const request = input as Partial<PreflightWorkflowRequest>;
      const baseDirectory = resolveDesktopWorkflowBaseDirectory(
        request.workflowFilePath,
        app.getPath('home'),
      );
      const modelCatalog = await loadUserModelCatalog(app.getPath('home'));
      const workflow = configureDesktopWorkflow(
        request.workflow,
        baseDirectory,
        modelCatalog.catalog,
      );
      const runInputs = parseWorkflowRunInputs(request.runInputs ?? {});
      const generic = await preflightWorkflow(
        workflow,
        new NodeWorkflowPreflight({ baseDirectory }),
        { hostEnvironment: process.env, runInputs },
      );
      const worktrees = await preflightAgentWorktrees(workflow, {
        runId: requestedRunId(request.runId),
        storageRoot: join(app.getPath('userData'), 'worktrees'),
        baseDirectory,
      });
      const issues = [...generic.issues, ...worktrees.issues];
      return {
        ready: !issues.some((issue) => issue.severity === 'blocker'),
        issues,
        blocks: applyAgentWorktreePreviews(
          generic.blocks,
          workflow,
          worktrees.scopes,
        ),
      };
    },
  );

  ipcMain.handle(IPC_CHANNELS.runWorkflow, async (event, input: unknown) => {
    const request = input as Partial<RunWorkflowRequest>;
    const baseDirectory = resolveDesktopWorkflowBaseDirectory(
      request.workflowFilePath,
      app.getPath('home'),
    );
    const modelCatalog = await loadUserModelCatalog(app.getPath('home'));
    const configuredWorkflow = parseRunnableWorkflow(
      configureDesktopWorkflow(
        request.workflow,
        baseDirectory,
        modelCatalog.catalog,
      ),
    );
    const runInputs = parseWorkflowRunInputs(request.runInputs ?? {});
    const runId = requestedRunId(request.runId);
    const worktreeRuntime = new WorktreeRuntime();
    let prepared: Awaited<ReturnType<typeof prepareAgentWorktrees>>;
    try {
      prepared = await prepareAgentWorktrees(configuredWorkflow, {
        runId,
        runInputs,
        storageRoot: join(app.getPath('userData'), 'worktrees'),
        baseDirectory,
        runtime: worktreeRuntime,
      });
    } catch (error) {
      if (error instanceof WorktreeRuntimeError) {
        throw new Error(`${error.message} ${error.nextAction}`);
      }
      throw error;
    }
    const run = startWorkflowRun(
      prepared.workflow,
      (runEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.runEvent, runEvent);
        }
      },
      {
        runId,
        baseDirectory,
        runInputs,
        onCompleted: async (record) => {
          const worktrees = await finalizeAgentWorktrees(
            prepared.scopes,
            record,
            worktreeRuntime,
          );
          await runHistory.append({ ...record, worktrees });
        },
      },
    );
    activeRuns.track(run);
    return { runId: run.runId };
  });

  ipcMain.handle(IPC_CHANNELS.cancelRun, (_event, runId: string) => {
    activeRuns.cancel(runId);
  });
}

async function findRetainedWorktree(
  runHistory: RunHistoryStore,
  runId: string,
  scopeId: string,
): Promise<{
  readonly record: RunHistoryRecord;
  readonly worktree: WorktreeRunRecord;
}> {
  const record = (await runHistory.list()).find(
    (candidate) => candidate.runId === runId,
  );
  const worktree = record?.worktrees?.find(
    (candidate) => candidate.scopeId === scopeId,
  );
  if (record === undefined || worktree === undefined) {
    throw new Error(`Run ${runId} has no retained worktree scope ${scopeId}.`);
  }
  if (worktree.state !== 'retained') {
    throw new Error(`Worktree scope ${scopeId} has already been cleaned.`);
  }
  return { record, worktree };
}

function worktreeScopeFromRecord(
  runId: string,
  record: WorktreeRunRecord,
): WorktreeScope {
  return {
    repositoryRoot: record.repositoryRoot,
    requestedBaseRef: record.baseCommit,
    baseCommit: record.baseCommit,
    sourceStatus: '',
    sourceIsDirty: record.sourceIsDirty,
    runId,
    scopeId: record.scopeId,
    branchName: record.branchName,
    worktreePath: record.worktreePath,
    participants: [],
    createdAt: record.createdAt,
  };
}

function requestedRunId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)
    ? value
    : crypto.randomUUID();
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return safe || 'workflow';
}

/** One binding path keeps authority review and process execution in agreement. */
function configureDesktopWorkflow(
  input: unknown,
  baseDirectory: string,
  catalog: Awaited<ReturnType<typeof loadUserModelCatalog>>['catalog'],
) {
  const portable = applyUserModelDefaults(
    normalizeAgentRuntimeWorkflow(parseWorkflowDefinition(input)).workflow,
    catalog,
  );
  return alignAgentRuntimeWorkingDirectories(
    applyDefaultWorkingDirectory(
      bindRuntimeHelpers(portable, helperResourcesDirectory),
      baseDirectory,
    ),
  );
}
