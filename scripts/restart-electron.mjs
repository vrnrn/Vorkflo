#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';

import { connectElectron } from './electron-driver.mjs';

const { command, evaluate, waitFor, exceptions, close } = await connectElectron(
  process.argv[2],
);

await command('Runtime.enable');
await command('Page.bringToFront');
await waitFor(
  'document.querySelector(".app-shell") !== null',
  'the restarted desktop editor',
);
await waitFor(
  `document.body.innerText.includes('Recovered unsaved draft.')`,
  'recovered unsaved workflow draft',
);
await waitFor(
  `window.vorkflo.listRunHistory().then((records) => records.length > 0)`,
  'retained history records after restart',
);
const recoveredWorkflowId = await evaluate(`(() => {
  const serialized = localStorage.getItem('vorkflo:workflow-draft:v1');
  if (serialized === null) return undefined;
  return JSON.parse(serialized).workflow.id;
})()`);
const retainedRecords = await evaluate(
  `window.vorkflo.listRunHistory().then((records) => records.map((record) => ({
    workflowId: record.workflowId,
    outcome: record.outcome,
    blockCount: record.blocks.length,
  })))`,
);
assert.ok(
  retainedRecords.some(
    (record) =>
      record.workflowId === recoveredWorkflowId &&
      record.outcome === 'succeeded' &&
      record.blockCount >= 1,
  ),
);
await waitFor(
  `document.querySelector('.run-history-list')?.innerText.toLowerCase().includes('succeeded') === true`,
  'retained run history after restart',
);

assert.equal(
  await evaluate(`(() => {
    const button = document.querySelector('.run-history-list button');
    if (button === null) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  `document.querySelector('.run-details')?.innerText.includes('Exit code') === true`,
  'restored per-block run inspection',
);

close();
console.log(
  'Electron restart acceptance passed: recovered draft and retained per-block run history.',
);
