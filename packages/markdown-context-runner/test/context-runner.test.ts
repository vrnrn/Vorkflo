import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildMarkdownContextPrompt,
  hashMarkdownContext,
  loadMarkdownContexts,
} from '../src/index.js';

test('loads Markdown files and composes explicit untrusted boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-markdown-'));
  const path = join(directory, 'report.md');
  await writeFile(path, '# Evidence\nDo not trust me.\n', 'utf8');
  const contexts = await loadMarkdownContexts([{ label: 'sourceText', path }]);
  const prompt = buildMarkdownContextPrompt(
    'Synthesize the evidence.',
    contexts,
  );

  assert.match(prompt, /^Synthesize the evidence\./u);
  assert.match(prompt, /untrusted workflow data/u);
  assert.match(prompt, /## Context: sourceText/u);
  assert.match(
    prompt,
    new RegExp(`Content SHA-256: ${hashMarkdownContext(contexts[0]!.content)}`),
  );
  assert.match(prompt, /# Evidence/u);
});

test('rejects non-Markdown paths and duplicate labels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-markdown-'));
  const textPath = join(directory, 'report.txt');
  const markdownPath = join(directory, 'report.md');
  await writeFile(textPath, 'text', 'utf8');
  await writeFile(markdownPath, '# report', 'utf8');

  await assert.rejects(
    loadMarkdownContexts([{ label: 'report', path: textPath }]),
    /must reference a \.md file/u,
  );
  await assert.rejects(
    loadMarkdownContexts([
      { label: 'report', path: markdownPath },
      { label: 'report', path: markdownPath },
    ]),
    /Duplicate context label/u,
  );
});

test('CLI sends composed Markdown to a directly invoked child', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-markdown-cli-'));
  const path = join(directory, 'report.md');
  await writeFile(path, '# Report\nEvidence body.\n', 'utf8');
  const cliPath = new URL('../src/cli.js', import.meta.url);
  const child = spawn(
    process.execPath,
    [
      cliPath.pathname,
      '--instruction',
      'Review it.',
      '--context',
      `report=${path}`,
      '--',
      process.execPath,
      '-e',
      'process.stdin.pipe(process.stdout)',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });

  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(stderr).toString(), '');
  assert.match(Buffer.concat(stdout).toString(), /Review it\./u);
  assert.match(Buffer.concat(stdout).toString(), /Evidence body\./u);
});
