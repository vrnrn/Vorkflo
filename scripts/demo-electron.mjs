#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connectElectron } from './electron-driver.mjs';

const { command, evaluate, waitFor, exceptions, close } = await connectElectron(
  process.argv[2],
);
await command('Runtime.enable');
await waitFor('document.querySelector(".app-shell") !== null', 'editor');
const workflow = JSON.parse(
  await readFile('examples/workflows/parallel-report.vorkflo.json', 'utf8'),
);
for (const block of workflow.blocks) block.invocation.workingDirectory = '/tmp';
// Only synthetic definitions enter this isolated application-data directory.
await evaluate(
  `localStorage.setItem('vorkflo:workflow-draft:v1', ${JSON.stringify(JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), workflow }))})`,
);
await command('Page.reload');
await waitFor(
  "document.querySelectorAll('.react-flow__node').length === 5",
  'synthetic workflow',
);
await evaluate(
  `document.querySelector('[aria-label="Review and run workflow"]')?.click()`,
);
// The visible button label is stable even when its shortcut hint changes.
await evaluate(
  `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Review & Run'))?.click()`,
);
await waitFor(
  'document.querySelector(".consent-row input") !== null',
  'authority review',
);
await evaluate('document.querySelector(".consent-row input").click()');
await waitFor(
  `Array.from(document.querySelectorAll('.run-modal button')).some(button => button.textContent?.includes('Run workflow') && !button.disabled)`,
  'runnable example',
);
await evaluate(
  `Array.from(document.querySelectorAll('.run-modal button')).find(button => button.textContent?.includes('Run workflow')).click()`,
);
await waitFor(
  'document.querySelector(".statusbar").innerText.includes("Last run: succeeded")',
  'example completion',
);
await evaluate(
  `document.querySelector('[data-id="assemble"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
);
await evaluate(`document.getElementById('inspector-configure-tab')?.click()`);
await command('Page.bringToFront');
await new Promise((resolve) => setTimeout(resolve, 500));
const text = await evaluate('document.body.innerText');
assert.doesNotMatch(
  text,
  /\/(?:Users|home)\/[^\s/]+/u,
  'Demo screenshot must not expose a real home path.',
);
assert.equal(exceptions.length, 0, 'Demo renderer must not throw.');
const screenshot = await command('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
});
await writeFile(
  'docs/assets/editor.png',
  Buffer.from(screenshot.data, 'base64'),
);
close();
console.log('Captured a successful synthetic workflow for the public README.');
