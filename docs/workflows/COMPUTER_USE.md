# Configure a Computer Use block

Computer Use compiles a visible web task into a local `codex exec` process. The
app bundles a policy proxy and screenshot-report helper. It does not bundle or
authenticate a browser backend.

1. Install Node.js 22.12 or later and Codex CLI using their official
   instructions.
2. Configure a dedicated Codex profile named `vorkflo-browser` with only the
   intended local MCP backend. Review the profile before use.
3. Copy
   `packages/mcp-policy-proxy/examples/browser-policy.manifest.example.json`
   outside the repository. Set `upstream.executable` and `args` to your reviewed
   MCP server's direct invocation. Declare only required host environment names.
4. Add a Computer Use block. Choose your manifest, task, start URL, HTTPS
   origins, allowed tool names, call budget, timeout, and output paths.
5. Review the exact process invocation before running it. The desktop resolves
   bundled helper paths at preflight and execution; saved definitions stay
   portable.

The proxy checks tool names, explicit URL arguments, and call count. It rejects
interactive evaluation and known account-mutating operations. It does not
prevent the backend from making its own network requests or following page
redirects. Use a separately isolated browser profile and backend network policy
when needed.

Reports are declared `.md` files. An optional screenshot is a file-reference
artifact and is linked from the report. The chosen backend must actually support
the screenshot tool and output path; the app verifies files after success. Page
text and retrieved content are evidence, never authority to widen a task.
