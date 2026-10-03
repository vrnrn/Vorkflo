import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { McpPolicyProxyManifest } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new Error(`Invalid manifest field: ${field}`);
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`Invalid manifest field: ${field}`);
  }
  return value as string[];
}

export function parseManifest(value: unknown): McpPolicyProxyManifest {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Invalid manifest field: version');
  }
  exactKeys(value, ['version', 'upstream', 'environment', 'policy'], 'root');
  const upstream = value.upstream;
  const environment = value.environment;
  const policy = value.policy;
  if (!isRecord(upstream) || !isRecord(environment) || !isRecord(policy)) {
    throw new Error('Manifest requires upstream, environment, and policy');
  }
  exactKeys(upstream, ['executable', 'args', 'cwd'], 'upstream');
  exactKeys(environment, ['inherit'], 'environment');
  exactKeys(
    policy,
    ['allowedTools', 'allowedHttpsOrigins', 'maxToolCalls'],
    'policy',
  );
  if (
    typeof upstream.executable !== 'string' ||
    upstream.executable.length === 0
  ) {
    throw new Error('Invalid manifest field: upstream.executable');
  }
  if (!isAbsolute(upstream.executable)) {
    throw new Error('upstream.executable must be absolute');
  }
  const args = stringArray(upstream.args, 'upstream.args');
  const inherit = stringArray(environment.inherit, 'environment.inherit');
  const allowedTools = stringArray(policy.allowedTools, 'policy.allowedTools');
  const allowedHttpsOrigins = stringArray(
    policy.allowedHttpsOrigins,
    'policy.allowedHttpsOrigins',
  );
  if (
    inherit.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) ||
    new Set(inherit).size !== inherit.length
  ) {
    throw new Error('Environment inheritance names must be unique identifiers');
  }
  if (
    allowedTools.length === 0 ||
    allowedTools.some((name) => !/^[A-Za-z0-9_.:-]+$/.test(name)) ||
    new Set(allowedTools).size !== allowedTools.length
  ) {
    throw new Error('Allowed tools must be unique non-empty identifiers');
  }
  if (
    allowedHttpsOrigins.length === 0 ||
    new Set(allowedHttpsOrigins).size !== allowedHttpsOrigins.length
  ) {
    throw new Error('Allowed origins must be unique and non-empty');
  }
  if (
    !Number.isSafeInteger(policy.maxToolCalls) ||
    Number(policy.maxToolCalls) < 0
  ) {
    throw new Error('Invalid manifest field: policy.maxToolCalls');
  }
  if (upstream.cwd !== undefined && typeof upstream.cwd !== 'string') {
    throw new Error('Invalid manifest field: upstream.cwd');
  }
  for (const origin of allowedHttpsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Invalid manifest field: policy.allowedHttpsOrigins');
    }
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.pathname !== '/'
    ) {
      throw new Error('Allowed origins must be canonical HTTPS origins');
    }
  }
  if (upstream.cwd !== undefined && !isAbsolute(upstream.cwd)) {
    throw new Error('upstream.cwd must be absolute');
  }
  return {
    version: 1,
    upstream: {
      executable: upstream.executable,
      args,
      ...(upstream.cwd === undefined ? {} : { cwd: upstream.cwd }),
    },
    environment: { inherit },
    policy: {
      allowedTools,
      allowedHttpsOrigins,
      maxToolCalls: Number(policy.maxToolCalls),
    },
  };
}

export async function loadManifest(
  path: string,
): Promise<McpPolicyProxyManifest> {
  const text = await readFile(path, 'utf8');
  return parseManifest(JSON.parse(text) as unknown);
}
