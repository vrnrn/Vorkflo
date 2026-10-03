import { isAbsolute } from 'node:path';
import type {
  SelectFilesystemPathRequest,
  SelectFilesystemPathResult,
} from '../shared/contracts.js';

interface OpenDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

interface SaveDialogResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface FilesystemPathDialog {
  showOpenDialog(options: {
    readonly title: string;
    readonly defaultPath?: string;
    readonly properties: readonly ('openFile' | 'openDirectory')[];
  }): Promise<OpenDialogResult>;
  showSaveDialog(options: {
    readonly title: string;
    readonly defaultPath?: string;
  }): Promise<SaveDialogResult>;
}

export interface FilesystemPathShell {
  showItemInFolder(path: string): void;
}

export interface FilesystemPathOpener {
  openPath(path: string): Promise<string>;
}

export async function selectFilesystemPath(
  dialog: FilesystemPathDialog,
  request: SelectFilesystemPathRequest,
): Promise<SelectFilesystemPathResult> {
  if (request.kind === 'output-file') {
    const selection = await dialog.showSaveDialog({
      title: 'Choose output file',
      ...(request.defaultPath === undefined
        ? {}
        : { defaultPath: request.defaultPath }),
    });
    if (selection.canceled || selection.filePath === undefined) {
      return { canceled: true };
    }
    return { canceled: false, path: selection.filePath };
  }
  const selection = await dialog.showOpenDialog({
    title: request.kind === 'directory' ? 'Choose directory' : 'Choose file',
    ...(request.defaultPath === undefined
      ? {}
      : { defaultPath: request.defaultPath }),
    properties: [request.kind === 'directory' ? 'openDirectory' : 'openFile'],
  });
  const path = selection.filePaths[0];
  if (selection.canceled || path === undefined) return { canceled: true };
  return { canceled: false, path };
}

export function revealFilesystemPath(
  shell: FilesystemPathShell,
  path: string,
): void {
  const normalized = path.trim();
  if (!isAbsolute(normalized)) {
    throw new Error('Only absolute filesystem artifact paths can be revealed.');
  }
  shell.showItemInFolder(normalized);
}

export async function openFilesystemPath(
  shell: FilesystemPathOpener,
  path: string,
): Promise<void> {
  const normalized = path.trim();
  if (!isAbsolute(normalized)) {
    throw new Error('Only absolute filesystem artifact paths can be opened.');
  }
  const error = await shell.openPath(normalized);
  if (error !== '') {
    throw new Error(`Could not open filesystem artifact: ${error}`);
  }
}
