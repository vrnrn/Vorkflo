import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { McpPolicyProxy } from '../src/proxy.js';
import type { McpPolicyProxyManifest } from '../src/types.js';

const fixture = fileURLToPath(
  new URL('./fixtures/fake-upstream.js', import.meta.url),
);

function manifest(
  overrides: Partial<McpPolicyProxyManifest['policy']> = {},
): McpPolicyProxyManifest {
  return {
    version: 1,
    upstream: { executable: process.execPath, args: [fixture] },
    environment: { inherit: [] },
    policy: {
      allowedTools: ['browser_navigate', 'browser_snapshot'],
      allowedHttpsOrigins: ['https://example.com'],
      maxToolCalls: 2,
      ...overrides,
    },
  };
}

function send(input: PassThrough, value: unknown): void {
  input.write(`${JSON.stringify(value)}\n`);
}

function nextMessage(output: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    output.once('data', (data: Buffer) => {
      resolve(
        JSON.parse(data.toString('utf8').trim()) as Record<string, unknown>,
      );
    });
  });
}

async function withProxy(
  config: McpPolicyProxyManifest,
  run: (
    input: PassThrough,
    output: PassThrough,
    proxy: McpPolicyProxy,
  ) => Promise<void>,
  parentEnvironment: NodeJS.ProcessEnv = {},
): Promise<void> {
  const input = new PassThrough();
  const output = new PassThrough();
  const proxy = new McpPolicyProxy(config, {
    input,
    output,
    parentEnvironment,
  });
  const completion = proxy.start();
  try {
    await run(input, output, proxy);
  } finally {
    await proxy.stop();
    await completion;
  }
}

function toolCall(id: number, name: string, args: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

function resultCode(message: Record<string, unknown>): string | undefined {
  const result = message['result'] as Record<string, unknown> | undefined;
  const structured = result?.['structuredContent'] as
    Record<string, unknown> | undefined;
  return structured?.['code'] as string | undefined;
}

function protocolErrorCode(
  message: Record<string, unknown>,
): number | undefined {
  return (message['error'] as Record<string, unknown> | undefined)?.['code'] as
    number | undefined;
}

test('forwards allowed navigation to an allowed HTTPS origin', async () => {
  await withProxy(manifest(), async (input, output) => {
    const response = nextMessage(output);
    send(
      input,
      toolCall(1, 'browser_navigate', { url: 'https://example.com/research' }),
    );
    const message = await response;
    assert.deepEqual(
      (message['result'] as Record<string, unknown>)['forwarded'],
      true,
    );
  });
});

test('denies disallowed origins without forwarding', async () => {
  await withProxy(manifest(), async (input, output) => {
    const response = nextMessage(output);
    send(
      input,
      toolCall(2, 'browser_navigate', {
        nested: { url: 'http://example.com' },
      }),
    );
    assert.equal(resultCode(await response), 'browser_origin_not_allowed');
  });
});

test('denies scheme-less values in navigation URL fields', async () => {
  await withProxy(manifest(), async (input, output) => {
    const response = nextMessage(output);
    send(
      input,
      toolCall(20, 'browser_navigate', { url: 'example.com/research' }),
    );
    assert.equal(resultCode(await response), 'browser_origin_not_allowed');
  });
});

test('recursively denies explicit URLs embedded in text', async () => {
  await withProxy(manifest(), async (input, output) => {
    const response = nextMessage(output);
    send(
      input,
      toolCall(22, 'browser_snapshot', {
        options: ['compare https://example.com with https://evil.example/path'],
      }),
    );
    assert.equal(resultCode(await response), 'browser_origin_not_allowed');
  });
});

test('rejects malformed tool calls and unrelated protocol methods locally', async () => {
  await withProxy(manifest(), async (input, output) => {
    let response = nextMessage(output);
    send(input, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { arguments: {} },
    });
    assert.equal(protocolErrorCode(await response), -32602);

    response = nextMessage(output);
    send(input, {
      jsonrpc: '2.0',
      id: 31,
      method: 'resources/read',
      params: { uri: 'file:///private/evidence' },
    });
    assert.equal(protocolErrorCode(await response), -32601);

    response = nextMessage(output);
    send(input, { jsonrpc: '2.0', id: 32, method: 'tools/list' });
    assert.deepEqual(
      ((await response)['result'] as Record<string, unknown>)['forwarded'],
      true,
    );
  });
});

test('inherits only explicitly allowlisted environment names', async () => {
  const config = manifest();
  config.environment.inherit = ['ALLOWED_TEST_VALUE'];
  await withProxy(
    config,
    async (input, output) => {
      const response = nextMessage(output);
      send(input, toolCall(21, 'browser_snapshot', {}));
      const result = (await response)['result'] as Record<string, unknown>;
      assert.deepEqual(result['environment'], { allowed: 'visible' });
    },
    { ALLOWED_TEST_VALUE: 'visible', SECRET_NOT_ALLOWED: 'hidden' },
  );
});

test('denies non-allowlisted and dangerous actions', async () => {
  await withProxy(manifest(), async (input, output) => {
    let response = nextMessage(output);
    send(input, toolCall(3, 'browser_click', { selector: '#safe' }));
    assert.equal(resultCode(await response), 'browser_action_not_allowed');

    response = nextMessage(output);
    send(
      input,
      toolCall(4, 'browser_snapshot', { action: 'publish account changes' }),
    );
    assert.equal(resultCode(await response), 'browser_action_not_allowed');
  });
});

test('dangerous JavaScript-style tool names stay denied even when allowlisted', async () => {
  await withProxy(
    manifest({ allowedTools: ['browser_run_code'] }),
    async (input, output) => {
      const response = nextMessage(output);
      send(input, toolCall(23, 'browser_run_code', { expression: '1 + 1' }));
      assert.equal(resultCode(await response), 'browser_action_not_allowed');
    },
  );
});

test('interactive ref tools stay denied even when allowlisted with neutral arguments', async () => {
  await withProxy(
    manifest({
      allowedTools: ['browser_click', 'browser_type', 'browser_select_option'],
    }),
    async (input, output) => {
      for (const [id, name, args] of [
        [24, 'browser_click', { ref: 'neutral-ref' }],
        [25, 'browser_type', { ref: 'neutral-ref', text: 'SPX' }],
        [26, 'browser_select_option', { ref: 'neutral-ref', value: '4h' }],
      ] as const) {
        const response = nextMessage(output);
        send(input, toolCall(id, name, args));
        assert.equal(resultCode(await response), 'browser_action_not_allowed');
      }
    },
  );
});

test('enforces the maximum forwarded tool-call budget', async () => {
  await withProxy(manifest({ maxToolCalls: 1 }), async (input, output) => {
    let response = nextMessage(output);
    send(input, toolCall(5, 'browser_snapshot', {}));
    assert.deepEqual(
      ((await response)['result'] as Record<string, unknown>)['forwarded'],
      true,
    );

    response = nextMessage(output);
    send(input, toolCall(6, 'browser_snapshot', {}));
    assert.equal(resultCode(await response), 'browser_action_budget_exhausted');
  });
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('Timed out waiting for fake upstream PID file');
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processExists(pid);
}

test('cancellation terminates the upstream process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-mcp-proxy-'));
  const pidFile = join(directory, 'pids');
  const config = manifest();
  config.environment.inherit = ['TEST_PID_FILE'];
  try {
    await withProxy(
      config,
      async (_input, _output, proxy) => {
        const [upstreamPid, grandchildPid] = (await waitForFile(pidFile))
          .trim()
          .split('\n')
          .map(Number);
        assert.equal(upstreamPid, proxy.upstreamPid);
        assert.ok(grandchildPid !== undefined && processExists(grandchildPid));
        await proxy.stop();
        assert.ok(upstreamPid !== undefined && !processExists(upstreamPid));
        assert.ok(
          grandchildPid !== undefined &&
            (await waitForProcessExit(grandchildPid)),
        );
      },
      { TEST_PID_FILE: pidFile, SECRET_NOT_ALLOWED: 'hidden' },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
