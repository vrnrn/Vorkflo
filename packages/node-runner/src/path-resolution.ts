import { delimiter, isAbsolute, resolve } from 'node:path';

export function resolveProcessWorkingDirectory(
  workingDirectory: string | undefined,
  baseDirectory: string = process.cwd(),
): string {
  return workingDirectory === undefined
    ? resolve(baseDirectory)
    : resolve(baseDirectory, workingDirectory);
}

export function resolveProcessFilesystemPath(
  path: string,
  workingDirectory: string | undefined,
  baseDirectory: string = process.cwd(),
): string {
  if (isAbsolute(path)) return resolve(path);
  return resolve(
    resolveProcessWorkingDirectory(workingDirectory, baseDirectory),
    path,
  );
}

/**
 * Produces the only direct-execution candidates the runner may inspect. A bare
 * executable without a declared PATH deliberately has no candidates, avoiding
 * the operating system's ambient fallback search path.
 */
export function resolveProcessExecutableCandidates(
  executable: string,
  workingDirectory: string | undefined,
  pathValue: string | undefined,
  baseDirectory: string = process.cwd(),
): readonly string[] {
  const cwd = resolveProcessWorkingDirectory(workingDirectory, baseDirectory);
  if (
    isAbsolute(executable) ||
    executable.includes('/') ||
    executable.includes('\\')
  ) {
    return [
      isAbsolute(executable) ? resolve(executable) : resolve(cwd, executable),
    ];
  }
  if (pathValue === undefined) return [];
  return pathValue
    .split(delimiter)
    .map((directory) =>
      resolve(cwd, directory.length === 0 ? '.' : directory, executable),
    );
}
