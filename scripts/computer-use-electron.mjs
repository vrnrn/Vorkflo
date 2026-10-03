#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';

import { connectElectron } from './electron-driver.mjs';

const { command, evaluate, waitFor, exceptions, close } = await connectElectron(
  process.argv[2],
);

await command('Runtime.enable');
await command('Page.bringToFront');
await waitFor('document.querySelector(".app-shell") !== null', 'editor');
assert.equal(
  await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Add Computer Use"]');
    if (button === null) return false;
    button.click();
    return true;
  })()`),
  true,
);
await waitFor(
  'document.querySelector(".computer-use-inspector") !== null',
  'Computer Use inspector',
);

const evidence = await evaluate(`(() => {
  const inspector = document.querySelector('.computer-use-inspector');
  const node = [...document.querySelectorAll('.process-node')]
    .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('Computer Use'));
  return {
    inspector: inspector?.innerText ?? '',
    invocation: inspector?.querySelector('.invocation-preview')?.innerText ?? inspector?.innerText ?? '',
    node: node?.getAttribute('aria-label') ?? '',
    startUrl: inspector?.querySelector('[data-inspector-field="editor.computerUse.startUrl"] input')?.value ?? '',
  };
})()`);
assert.match(evidence.inspector, /Bounded browser session/);
assert.match(evidence.inspector, /Allowed origins/);
assert.match(evidence.inspector, /Allowed MCP tools/);
assert.match(evidence.inspector, /Visible instruction/i);
assert.match(evidence.inspector, /Configure the browser backend separately/i);
assert.match(evidence.invocation, /codex/);
assert.match(evidence.invocation, /mcp_servers\.browser\.required=true/);
assert.match(evidence.invocation, /features\.shell_tool=false/);
assert.match(evidence.invocation, /browser_take_screenshot/);
assert.match(evidence.node, /^Computer Use/);
assert.equal(evidence.startUrl, 'https://example.com/');

close();
console.log(
  'Computer Use editor acceptance passed: bounded Codex/MCP invocation is visible without launching a browser or network call.',
);
