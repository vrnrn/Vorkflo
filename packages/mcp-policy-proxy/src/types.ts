export const POLICY_CODES = {
  originNotAllowed: 'browser_origin_not_allowed',
  actionNotAllowed: 'browser_action_not_allowed',
  budgetExhausted: 'browser_action_budget_exhausted',
} as const;

export type PolicyCode = (typeof POLICY_CODES)[keyof typeof POLICY_CODES];

export interface McpPolicyProxyManifest {
  version: 1;
  upstream: {
    executable: string;
    args: string[];
    cwd?: string;
  };
  environment: {
    inherit: string[];
  };
  policy: {
    allowedTools: string[];
    allowedHttpsOrigins: string[];
    maxToolCalls: number;
  };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}
