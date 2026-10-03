#!/usr/bin/env node

import { spawn } from 'node:child_process';

import {
  buildMarkdownContextPrompt,
  loadMarkdownContexts,
  type MarkdownContextReference,
} from './index.js';

interface CliOptions {
  readonly instruction: string;
  readonly contexts: readonly MarkdownContextReference[];
  readonly executable: string;
  readonly arguments: readonly string[];
}

function usage(): never {
  throw new Error(
    'Usage: vorkflo-markdown-context-runner --instruction TEXT --context LABEL=PATH [--context LABEL=PATH ...] -- EXECUTABLE [ARG ...]',
  );
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let instruction: string | undefined;
  const contexts: MarkdownContextReference[] = [];
  let index = 0;
  for (; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--') break;
    const value = arguments_[index + 1];
    if (argument === '--instruction' && value !== undefined) {
      instruction = value;
      index += 1;
      continue;
    }
    if (argument === '--context' && value !== undefined) {
      const separator = value.indexOf('=');
      if (separator < 1 || separator === value.length - 1) usage();
      contexts.push({
        label: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
      index += 1;
      continue;
    }
    usage();
  }
  const executable = arguments_[index + 1];
  if (instruction === undefined || executable === undefined) usage();
  return {
    instruction,
    contexts,
    executable,
    arguments: arguments_.slice(index + 2),
  };
}

async function runChild(
  executable: string,
  arguments_: readonly string[],
  stdin: string,
): Promise<number> {
  const child = spawn(executable, arguments_, {
    shell: false,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.end(stdin);
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
  const contexts = await loadMarkdownContexts(options.contexts);
  const prompt = buildMarkdownContextPrompt(options.instruction, contexts);
  process.exitCode = await runChild(
    options.executable,
    options.arguments,
    prompt,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
