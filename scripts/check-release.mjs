#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, appendFile, access } from 'node:fs/promises';

const root = JSON.parse(await readFile('package.json', 'utf8'));
const desktop = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
assert.match(root.version, /^\d+\.\d+\.\d+$/u);
assert.equal(
  root.version,
  desktop.version,
  'Root and desktop versions must match.',
);
assert.equal(process.platform, 'darwin', 'The release build requires macOS.');
assert.equal(
  process.arch,
  'arm64',
  'The supported release requires an Apple silicon runner.',
);
if (process.env.GITHUB_REF_TYPE === 'tag')
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `v${root.version}`,
    'Tag and package version must match.',
  );
else if (process.env.GITHUB_ACTIONS === 'true')
  assert.equal(
    process.env.GITHUB_REF_NAME,
    'main',
    'Manual publication must run from main.',
  );
await access(`docs/release/${root.version}.md`);
if (process.env.GITHUB_OUTPUT !== undefined)
  await appendFile(process.env.GITHUB_OUTPUT, `version=${root.version}\n`);
console.log(`Release ${root.version}: version and architecture verified.`);
