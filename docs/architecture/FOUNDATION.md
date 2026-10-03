# Architecture

Vorkflo keeps workflow semantics separate from user interfaces and machine-local
authority.

```text
React canvas → typed preload bridge → Electron host
                                      ↓
                              portable workflow engine
                                      ↓
                                process-runner interface
                                      ↓
                                Node runtime adapter
```

## Engine

`packages/engine` owns versioned definitions, parsing, semantic validation, DAG
planning, scheduling, artifact routing, cancellation, and typed runtime events.
It has no imports from Electron, React, CLI providers, or desktop code. Text,
JSON, and file references carry data; events describe execution.

## Desktop

`apps/desktop/src/main` owns native dialogs, local bindings, model preferences,
process authority, run history, and explicit Git worktrees. It reparses workflow
and input data before execution. Computer Use configurations are recompiled from
their validated metadata at this boundary, so displayed settings cannot silently
contradict a stale saved invocation.

`src/preload` exposes only the typed `VorkfloBridge`. Context isolation and
Electron sandboxing are enabled; the renderer cannot import Node.js or invoke
arbitrary IPC. Editor navigation and additional windows are denied.

`src/renderer` owns canvas interaction and workflow history. Process
configuration, Agent configuration, Computer Use configuration, run inspection,
authority review, and input editing have separate components. Runtime snapshots
project engine state; components do not define scheduling semantics.

## Runtime adapters and helpers

`packages/node-runner` resolves declared environment values, working
directories, inputs, and executable paths. It implements the generic
process-runner interface with direct invocation, typed failures, bounded
timeouts, and process-group cancellation. Shell evaluation is explicit.

`packages/mcp-policy-proxy` independently checks MCP tool and URL-argument
allowlists and call budgets. It is not a network sandbox for the backend.
`packages/markdown-context-runner` provides explicit Markdown context
composition and verified image-report finalization.

Helpers are copied as JavaScript-only application resources outside the ASAR
archive, where ordinary Node subprocesses can load them. Portable helper
references are resolved identically before authority review and execution.
User-selected external scripts and backend manifests remain explicit local
bindings. Saved workflows are never rewritten with installation paths.

## Persistence

Portable workflow files contain declared structure, configuration, and layout.
They do not include execution history. Unsaved drafts and retained runs are
machine-local application data. The history store applies a 30-day and 100 MiB
limit, pruning old records first. Worktrees with changes or retained artifact
references require explicit review; the application does not automatically
merge, push, publish, or discard them.
