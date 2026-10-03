import { describe, expect, it, vi } from 'vitest';
import {
  openFilesystemPath,
  revealFilesystemPath,
  selectFilesystemPath,
  type FilesystemPathDialog,
  type FilesystemPathOpener,
  type FilesystemPathShell,
} from '../src/main/path-actions';

describe('filesystem path actions', () => {
  it.each([
    ['file', 'openFile'],
    ['directory', 'openDirectory'],
  ] as const)('selects one native %s path', async (kind, property) => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/workspace/selected'],
    }));
    const dialog: FilesystemPathDialog = {
      showOpenDialog,
      showSaveDialog: vi.fn(),
    };

    await expect(
      selectFilesystemPath(dialog, {
        kind,
        defaultPath: '/workspace',
      }),
    ).resolves.toEqual({
      canceled: false,
      path: '/workspace/selected',
    });
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: kind === 'file' ? 'Choose file' : 'Choose directory',
      defaultPath: '/workspace',
      properties: [property],
    });
  });

  it('preserves native picker cancellation', async () => {
    const dialog: FilesystemPathDialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(),
    };

    await expect(
      selectFilesystemPath(dialog, { kind: 'file' }),
    ).resolves.toEqual({ canceled: true });
  });

  it('selects a not-yet-created output file through the native save dialog', async () => {
    const showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: '/workspace/new-output.txt',
    }));
    const dialog: FilesystemPathDialog = {
      showOpenDialog: vi.fn(),
      showSaveDialog,
    };

    await expect(
      selectFilesystemPath(dialog, {
        kind: 'output-file',
        defaultPath: '/workspace/output.txt',
      }),
    ).resolves.toEqual({
      canceled: false,
      path: '/workspace/new-output.txt',
    });
    expect(showSaveDialog).toHaveBeenCalledWith({
      title: 'Choose output file',
      defaultPath: '/workspace/output.txt',
    });
  });

  it('reveals only absolute artifact paths', () => {
    const showItemInFolder = vi.fn();
    const shell: FilesystemPathShell = { showItemInFolder };

    revealFilesystemPath(shell, '/workspace/output.txt');
    expect(showItemInFolder).toHaveBeenCalledWith('/workspace/output.txt');
    expect(() => revealFilesystemPath(shell, './output.txt')).toThrow(
      'Only absolute filesystem artifact paths can be revealed.',
    );
  });

  it('opens only absolute artifact paths in the operating-system default app', async () => {
    const openPath = vi.fn(async () => '');
    const shell: FilesystemPathOpener = { openPath };

    await expect(
      openFilesystemPath(shell, '/workspace/report.md'),
    ).resolves.toBeUndefined();
    expect(openPath).toHaveBeenCalledWith('/workspace/report.md');
    await expect(openFilesystemPath(shell, './report.md')).rejects.toThrow(
      'Only absolute filesystem artifact paths can be opened.',
    );
  });

  it('surfaces the operating-system error when an artifact cannot be opened', async () => {
    const shell: FilesystemPathOpener = {
      openPath: vi.fn(async () => 'No application is registered.'),
    };

    await expect(
      openFilesystemPath(shell, '/workspace/report.unknown'),
    ).rejects.toThrow(
      'Could not open filesystem artifact: No application is registered.',
    );
  });
});
