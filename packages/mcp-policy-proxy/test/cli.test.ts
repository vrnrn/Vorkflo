import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixture = fileURLToPath(
  new URL('./fixtures/fake-upstream.js', import.meta.url),
);

test('explicit CLI policy arguments replace manifest policy authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-mcp-cli-'));
  const config = join(directory, 'manifest.json');
  await writeFile(
    config,
    JSON.stringify({
      version: 1,
      upstream: { executable: process.execPath, args: [fixture] },
      environment: { inherit: [] },
      policy: {
        allowedTools: ['browser_snapshot'],
        allowedHttpsOrigins: ['https://manifest.example'],
        maxToolCalls: 99,
      },
    }),
    'utf8',
  );
  const child = spawn(
    process.execPath,
    [
      cli,
      '--config',
      config,
      '--allowed-origin',
      'https://cli.example',
      '--allowed-tool',
      'browser_navigate',
      '--max-actions',
      '1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const lines = createInterface({ input: child.stdout });
  const responses: Array<Record<string, unknown>> = [];
  lines.on('line', (line) =>
    responses.push(JSON.parse(line) as Record<string, unknown>),
  );
  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: { url: 'https://manifest.example/path' },
        },
      })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: { url: 'https://cli.example/path' },
        },
      })}\n`,
    );
    for (let attempt = 0; responses.length < 2 && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(responses.length, 2);
    const firstResult = responses[0]?.['result'] as Record<string, unknown>;
    const firstStructured = firstResult['structuredContent'] as Record<
      string,
      unknown
    >;
    assert.equal(firstStructured['code'], 'browser_origin_not_allowed');
    const secondResult = responses[1]?.['result'] as Record<string, unknown>;
    assert.equal(secondResult['forwarded'], true);
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
