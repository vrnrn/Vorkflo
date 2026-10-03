#!/usr/bin/env node

import { spawn } from 'node:child_process';

import { finalizeMarkdownPngReference } from './image-report.js';

interface CliOptions {
  readonly reportPath: string;
  readonly imagePath: string;
  readonly alt: string;
  readonly executable: string;
  readonly arguments: readonly string[];
}

function usage(): never {
  throw new Error(
    'Usage: vorkflo-markdown-image-report --report PATH --image PATH --alt TEXT -- EXECUTABLE [ARG ...]',
  );
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let reportPath: string | undefined;
  let imagePath: string | undefined;
  let alt: string | undefined;
  let index = 0;
  for (; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--') break;
    const value = arguments_[index + 1];
    if (argument === '--report' && value !== undefined) reportPath = value;
    else if (argument === '--image' && value !== undefined) imagePath = value;
    else if (argument === '--alt' && value !== undefined) alt = value;
    else usage();
    index += 1;
  }
  const executable = arguments_[index + 1];
  if (
    reportPath === undefined ||
    imagePath === undefined ||
    alt === undefined ||
    executable === undefined
  ) {
    usage();
  }
  return {
    reportPath,
    imagePath,
    alt,
    executable,
    arguments: arguments_.slice(index + 2),
  };
}

async function runChild(
  executable: string,
  arguments_: readonly string[],
): Promise<number> {
  const child = spawn(executable, arguments_, {
    shell: false,
    stdio: 'inherit',
  });
  return new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Child process terminated by signal ${signal}.`));
      } else {
        resolveExit(code ?? 1);
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const exitCode = await runChild(options.executable, options.arguments);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }
  await finalizeMarkdownPngReference(
    options.reportPath,
    options.imagePath,
    options.alt,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
