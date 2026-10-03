#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadManifest, parseManifest } from './manifest.js';
import { McpPolicyProxy } from './proxy.js';
import type { McpPolicyProxyManifest } from './types.js';

interface CliOptions {
  config: string;
  allowedOrigins: string[];
  allowedTools: string[];
  maxActions?: number;
}

function cliOptions(argv: string[]): CliOptions {
  let config: string | undefined;
  const allowedOrigins: string[] = [];
  const allowedTools: string[] = [];
  let maxActions: number | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined)
      throw new Error('Every CLI option requires a value');
    if (flag === '--config') config = resolve(value);
    else if (flag === '--allowed-origin') allowedOrigins.push(value);
    else if (flag === '--allowed-tool') allowedTools.push(value);
    else if (flag === '--max-actions') {
      maxActions = Number(value);
      if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
        throw new Error('--max-actions must be a non-negative integer');
      }
    } else throw new Error(`Unknown CLI option: ${flag}`);
  }
  if (config === undefined) {
    throw new Error('Usage: vorkflo-mcp-policy-proxy --config <manifest.json>');
  }
  const hasPolicyOverride =
    allowedOrigins.length > 0 ||
    allowedTools.length > 0 ||
    maxActions !== undefined;
  if (
    hasPolicyOverride &&
    (allowedOrigins.length === 0 ||
      allowedTools.length === 0 ||
      maxActions === undefined)
  ) {
    throw new Error(
      'CLI policy override requires --allowed-origin, --allowed-tool, and --max-actions',
    );
  }
  return {
    config,
    allowedOrigins,
    allowedTools,
    ...(maxActions === undefined ? {} : { maxActions }),
  };
}

function applyCliPolicy(
  manifest: McpPolicyProxyManifest,
  options: CliOptions,
): McpPolicyProxyManifest {
  if (options.maxActions === undefined) return manifest;
  return parseManifest({
    ...manifest,
    policy: {
      allowedHttpsOrigins: options.allowedOrigins,
      allowedTools: options.allowedTools,
      maxToolCalls: options.maxActions,
    },
  });
}

async function main(): Promise<void> {
  const options = cliOptions(process.argv.slice(2));
  const manifest = applyCliPolicy(await loadManifest(options.config), options);
  const proxy = new McpPolicyProxy(manifest);
  const code = await proxy.start();
  process.exitCode = code ?? 1;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown proxy failure';
  process.stderr.write(`MCP policy proxy failed: ${message}\n`);
  process.exitCode = 1;
});
