#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import electron from 'electron';

const userDataDirectory = await mkdtemp(
  join(tmpdir(), 'vorkflo-electron-smoke-'),
);
const mainPath = resolve('apps/desktop/out/main/index.js');
const packaged = process.argv.includes('--packaged');
const performanceAcceptance = process.argv.includes('--performance');
const demo = process.argv.includes('--demo');
const executable = packaged
  ? resolve(
      `apps/desktop/release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Vorkflo.app/Contents/MacOS/Vorkflo`,
    )
  : electron;
let diagnostics = '';
let child = launchElectron(await availablePort());

try {
  if (packaged)
    await runNode(
      'scripts/verify-runtime-helpers.mjs',
      resolve(executable, '../../Resources'),
    );
  let port = child.port;
  await waitForElectron(port, child);
  if (demo) {
    await runNode('scripts/demo-electron.mjs', String(port));
  } else if (performanceAcceptance) {
    await runNode('scripts/performance-electron.mjs', String(port));
  } else {
    await runNode('scripts/smoke-electron.mjs', String(port));
    await runNode('scripts/computer-use-electron.mjs', String(port));

    await stopElectron(child);
    child = launchElectron(await availablePort());
    port = child.port;
    await waitForElectron(port, child);
    await runNode('scripts/restart-electron.mjs', String(port));
  }
} catch (error) {
  if (diagnostics.length > 0) process.stderr.write(diagnostics);
  throw error;
} finally {
  await stopElectron(child);
  await rm(userDataDirectory, { recursive: true, force: true });
}

console.log(
  `Production ${packaged ? 'packaged application' : 'development bundle'} ${demo ? 'demo capture' : performanceAcceptance ? 'performance acceptance' : 'smoke'} completed.`,
);

function launchElectron(port) {
  const arguments_ = packaged
    ? [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDirectory}`,
      ]
    : [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDirectory}`,
        mainPath,
      ];
  const launched = spawn(executable, arguments_, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launched.port = port;
  launched.stdout?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  launched.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  return launched;
}

async function stopElectron(electronProcess) {
  if (
    electronProcess.exitCode !== null ||
    electronProcess.signalCode !== null
  ) {
    return;
  }
  electronProcess.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => electronProcess.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (
    electronProcess.exitCode === null &&
    electronProcess.signalCode === null
  ) {
    electronProcess.kill('SIGKILL');
    await Promise.race([
      new Promise((resolveExit) => electronProcess.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForElectron(port, electronProcess) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (electronProcess.exitCode !== null) {
      throw new Error(
        `Electron exited before acceptance (code ${electronProcess.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) return;
    } catch {
      // The debugging endpoint is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Timed out waiting for the Electron debugging endpoint.');
}

async function runNode(script, ...arguments_) {
  await new Promise((resolveRun, rejectRun) => {
    const command = spawn(process.execPath, [script, ...arguments_], {
      stdio: 'inherit',
    });
    command.once('error', rejectRun);
    command.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${script} failed (${signal === null ? `code ${code}` : `signal ${signal}`}).`,
          ),
        );
    });
  });
}
