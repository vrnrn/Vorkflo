# MCP policy proxy

Provider-neutral, newline-delimited MCP stdio proxy for placing a narrow browser
policy boundary between Codex and an upstream browser MCP server.

The proxy starts only the configured executable and argument array
(`shell: false`), passes through only named environment variables, and does not
log tool arguments or upstream stderr. Client traffic is limited to MCP
initialization, ping, tool discovery, bounded tool calls, and cancellation;
malformed tool calls and unrelated methods are rejected locally. A `tools/call`
reaches the upstream only when its exact tool name is allowed, its recursively
inspected HTTP(S) URLs use an allowed HTTPS origin, it contains no prohibited
action terms, and budget remains. Denied calls return an MCP tool error with one
stable code:

- `browser_origin_not_allowed`
- `browser_action_not_allowed`
- `browser_action_budget_exhausted`

Ref-based interaction tools such as click, type, select, keypress, and drag are
denied even if they appear in the configured tool list. A neutral DOM reference
does not carry enough evidence to prove that the underlying control is not Buy,
Sell, Trade, Publish, an order ticket, or an account action. This conservative
v0.4 proxy therefore supports navigation, observation, waiting, and evidence
capture only. A future interactive policy must bind references to a verified
snapshot role/name before forwarding them.

Copy `examples/browser-policy.manifest.example.json`, use absolute local paths,
and set the narrowest possible tool, origin, environment, and budget lists.

## Codex MCP configuration

After running `npm run build --workspace @vorkflo/mcp-policy-proxy`, add this
exact shape to `~/.codex/config.toml` (replace both placeholder absolute paths):

```toml
[mcp_servers.policy_browser]
command = "node"
args = [
  "/absolute/path/to/Vorkflo/packages/mcp-policy-proxy/dist/src/cli.js",
  "--config",
  "/absolute/path/to/browser-policy.manifest.json",
  "--allowed-origin",
  "https://example.com",
  "--allowed-tool",
  "browser_navigate",
  "--allowed-tool",
  "browser_snapshot",
  "--max-actions",
  "20",
]
```

The upstream browser MCP belongs in the JSON manifest, not as a shell command or
in the Codex configuration. When any CLI policy override is present, all three
policy dimensions must be explicit; repeated origins and tools plus the maximum
action count replace the manifest policy. This lets a visible workflow compile
the exact authority into server-registration arguments, without ambient prompt
or environment state granting authority. Closing stdin, terminating the proxy,
or calling its programmatic `stop()` terminates the entire upstream process
group.
