import {
  POLICY_CODES,
  type McpPolicyProxyManifest,
  type PolicyCode,
} from './types.js';

const DANGEROUS_TERMS = [
  'javascript',
  'evaluate',
  'eval',
  'script',
  'upload',
  'download',
  'broker',
  'trade',
  'trading',
  'order',
  'publish',
  'account',
  'buy',
  'sell',
] as const;

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function containsDangerousTerm(value: string): boolean {
  const tokens = new Set(normalizedTokens(value));
  return (
    DANGEROUS_TERMS.some((term) => tokens.has(term)) ||
    (tokens.has('run') && tokens.has('code'))
  );
}

function isUnverifiableInteractiveTool(toolName: string): boolean {
  const tokens = new Set(normalizedTokens(toolName));
  return ['click', 'type', 'select', 'press', 'key', 'drag', 'drop'].some(
    (term) => tokens.has(term),
  );
}

function explicitHttpUrls(value: string): string[] {
  return value.match(/https?:\/\/[^\s"'<>]+/giu) ?? [];
}

function isNavigationUrlField(key: string): boolean {
  return normalizedTokens(key).some((token) =>
    ['url', 'uri', 'href', 'origin'].includes(token),
  );
}

function inspectArguments(
  value: unknown,
  allowedOrigins: ReadonlySet<string>,
  key = '',
): PolicyCode | undefined {
  if (typeof value === 'string') {
    const explicitUrls = explicitHttpUrls(value);
    for (const explicitUrl of explicitUrls) {
      let url: URL;
      try {
        url = new URL(explicitUrl);
      } catch {
        return POLICY_CODES.originNotAllowed;
      }
      if (url.protocol !== 'https:' || !allowedOrigins.has(url.origin)) {
        return POLICY_CODES.originNotAllowed;
      }
    }
    if (explicitUrls.length === 0 && isNavigationUrlField(key)) {
      return POLICY_CODES.originNotAllowed;
    }
    if (containsDangerousTerm(key) || containsDangerousTerm(value)) {
      return POLICY_CODES.actionNotAllowed;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const denial = inspectArguments(entry, allowedOrigins, key);
      if (denial !== undefined) return denial;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      if (containsDangerousTerm(childKey)) return POLICY_CODES.actionNotAllowed;
      const denial = inspectArguments(child, allowedOrigins, childKey);
      if (denial !== undefined) return denial;
    }
  }
  return undefined;
}

export class BrowserPolicy {
  readonly #allowedTools: ReadonlySet<string>;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #maxToolCalls: number;
  #toolCalls = 0;

  constructor(manifest: McpPolicyProxyManifest) {
    this.#allowedTools = new Set(manifest.policy.allowedTools);
    this.#allowedOrigins = new Set(manifest.policy.allowedHttpsOrigins);
    this.#maxToolCalls = manifest.policy.maxToolCalls;
  }

  authorize(toolName: string, args: unknown): PolicyCode | undefined {
    if (
      !this.#allowedTools.has(toolName) ||
      containsDangerousTerm(toolName) ||
      isUnverifiableInteractiveTool(toolName)
    ) {
      return POLICY_CODES.actionNotAllowed;
    }
    const denial = inspectArguments(args, this.#allowedOrigins);
    if (denial !== undefined) return denial;
    if (this.#toolCalls >= this.#maxToolCalls)
      return POLICY_CODES.budgetExhausted;
    this.#toolCalls += 1;
    return undefined;
  }

  get toolCalls(): number {
    return this.#toolCalls;
  }
}
