import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BrowserPolicy } from './policy.js';
import type {
  JsonRpcRequest,
  McpPolicyProxyManifest,
  PolicyCode,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function policyToolError(id: JsonRpcRequest['id'], code: PolicyCode): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      content: [{ type: 'text', text: code }],
      structuredContent: { code },
      isError: true,
    },
  });
}

function protocolError(
  id: JsonRpcRequest['id'],
  code: -32700 | -32600 | -32601 | -32602,
  message: string,
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  });
}

const ALLOWED_CLIENT_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
  'tools/call',
]);

function parseToolCall(
  value: unknown,
): { request: JsonRpcRequest; toolName: string; args: unknown } | undefined {
  if (
    !isRecord(value) ||
    value.jsonrpc !== '2.0' ||
    value.method !== 'tools/call'
  ) {
    return undefined;
  }
  const params = value.params;
  if (!isRecord(params) || typeof params.name !== 'string') return undefined;
  return {
    request: value as unknown as JsonRpcRequest,
    toolName: params.name,
    args: params.arguments,
  };
}

export interface PolicyProxyOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  parentEnvironment?: NodeJS.ProcessEnv;
}

export class McpPolicyProxy {
  readonly #manifest: McpPolicyProxyManifest;
  readonly #input: NodeJS.ReadableStream;
  readonly #output: NodeJS.WritableStream;
  readonly #parentEnvironment: NodeJS.ProcessEnv;
  readonly #policy: BrowserPolicy;
  #child: ChildProcessWithoutNullStreams | undefined;
  #stopping: Promise<void> | undefined;
  #removeSignalHandlers: (() => void) | undefined;

  constructor(
    manifest: McpPolicyProxyManifest,
    options: PolicyProxyOptions = {},
  ) {
    this.#manifest = manifest;
    this.#input = options.input ?? process.stdin;
    this.#output = options.output ?? process.stdout;
    this.#parentEnvironment = options.parentEnvironment ?? process.env;
    this.#policy = new BrowserPolicy(manifest);
  }

  get upstreamPid(): number | undefined {
    return this.#child?.pid;
  }

  start(): Promise<number | null> {
    if (this.#child !== undefined) throw new Error('Proxy already started');
    const env: NodeJS.ProcessEnv = {};
    for (const name of this.#manifest.environment.inherit) {
      const value = this.#parentEnvironment[name];
      if (value !== undefined) env[name] = value;
    }
    const child = spawn(
      this.#manifest.upstream.executable,
      this.#manifest.upstream.args,
      {
        ...(this.#manifest.upstream.cwd === undefined
          ? {}
          : { cwd: this.#manifest.upstream.cwd }),
        env,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#child = child;
    child.stderr.resume();

    const clientLines = createInterface({ input: this.#input });
    const upstreamLines = createInterface({ input: child.stdout });
    clientLines.on('line', (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        this.#output.write(`${protocolError(null, -32700, 'Parse error')}\n`);
        return;
      }
      if (
        !isRecord(message) ||
        message.jsonrpc !== '2.0' ||
        typeof message.method !== 'string'
      ) {
        this.#output.write(
          `${protocolError(null, -32600, 'Invalid Request')}\n`,
        );
        return;
      }
      const request = message as unknown as JsonRpcRequest;
      if (!ALLOWED_CLIENT_METHODS.has(message.method)) {
        if (request.id !== undefined) {
          this.#output.write(
            `${protocolError(request.id, -32601, 'Method not found')}\n`,
          );
        }
        return;
      }
      const toolCall = parseToolCall(message);
      if (message.method === 'tools/call') {
        if (toolCall === undefined) {
          this.#output.write(
            `${protocolError(request.id, -32602, 'Invalid tool call parameters')}\n`,
          );
          return;
        }
        const denial = this.#policy.authorize(toolCall.toolName, toolCall.args);
        if (denial !== undefined) {
          this.#output.write(
            `${policyToolError(toolCall.request.id, denial)}\n`,
          );
          return;
        }
      }
      child.stdin.write(`${line}\n`);
    });
    upstreamLines.on('line', (line) => this.#output.write(`${line}\n`));
    this.#input.once('end', () => void this.stop());
    this.#input.once('close', () => void this.stop());

    const stop = (): void => void this.stop();
    const killOnExit = (): void => this.#killGroup('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.once('SIGHUP', stop);
    process.once('exit', killOnExit);
    this.#removeSignalHandlers = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGHUP', stop);
      process.removeListener('exit', killOnExit);
    };

    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        clientLines.close();
        upstreamLines.close();
        this.#removeSignalHandlers?.();
        this.#removeSignalHandlers = undefined;
        resolve(code);
      });
    });
  }

  stop(): Promise<void> {
    if (this.#stopping !== undefined) return this.#stopping;
    this.#stopping = this.#terminateUpstream();
    return this.#stopping;
  }

  async #terminateUpstream(): Promise<void> {
    const child = this.#child;
    if (child === undefined || child.exitCode !== null) return;
    child.stdin.end();
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    this.#killGroup('SIGTERM');
    const escalation = setTimeout(() => this.#killGroup('SIGKILL'), 1_000);
    escalation.unref();
    await exited;
    clearTimeout(escalation);
  }

  #killGroup(signal: NodeJS.Signals): void {
    const pid = this.#child?.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === 'win32') this.#child?.kill(signal);
      else process.kill(-pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') throw error;
    }
  }
}
