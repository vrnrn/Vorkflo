#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const resources = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), 'vorkflo-helper-check-'));
try {
  const report = join(directory, 'report.md');
  const image = join(directory, 'evidence.png');
  const fixture = join(directory, 'controlled-agent.cjs');
  await writeFile(
    fixture,
    `const fs = require('node:fs');
    fs.writeFileSync(process.argv[2], '# Synthetic report\\n\\n## Evidence image\\n![Example evidence](' + process.argv[3] + ')\\n');
    fs.writeFileSync(process.argv[3], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64'));
  `,
  );
  const finalizer = spawnSync(
    process.execPath,
    [
      join(
        resources,
        'helpers/markdown-context-runner/src/image-report-cli.js',
      ),
      '--report',
      report,
      '--image',
      image,
      '--alt',
      'Example evidence',
      '--',
      process.execPath,
      fixture,
      report,
      image,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(
    finalizer.status,
    0,
    finalizer.stderr || String(finalizer.error),
  );
  assert.match(
    await readFile(report, 'utf8'),
    /!\[Example evidence\]\(\.\/evidence\.png\)/u,
  );
  // Invalid arguments must produce the proxy's own typed usage error, proving
  // that its complete module graph loads from installed, non-ASAR resources.
  const proxy = spawnSync(
    process.execPath,
    [join(resources, 'helpers/mcp-policy-proxy/src/cli.js')],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(proxy.status, 1);
  assert.match(proxy.stderr, /Usage: vorkflo-mcp-policy-proxy/u);
  assert.doesNotMatch(proxy.stderr, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/u);
  console.log('Installed runtime helpers passed controlled execution checks.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
