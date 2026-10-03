# Vorkflo desktop

Electron host and React canvas for the v0.4 local workflow experience.

## Boundaries

- `src/renderer` edits portable `@vorkflo/engine` workflow definitions. It
  cannot access Node.js, the filesystem, or process APIs.
- `src/preload` exposes the narrow `VorkfloBridge` declared in
  `src/shared/contracts.ts`. Context isolation and Electron sandboxing stay
  enabled.
- `src/main` owns native file dialogs and local execution authority. It
  delegates DAG scheduling and artifact routing to `executeWorkflow` and
  delegates child process behavior to `@vorkflo/node-runner`.
- `src/shared/agent-runtime.ts` owns the capability registry and compiles Codex,
  Cline, and Antigravity editor settings to generic process definitions.
  `src/main/worktree-runtime.ts` owns explicit run-scoped Git worktrees; neither
  boundary adds Agent, model-provider, or Git scheduling concepts to the engine.
- Saved files contain only the versioned workflow definition. Canvas positions
  live in `workflow.layout`; retained run snapshots are sensitive local
  application data and never enter portable workflow files.
- Model choices are loaded through the main/preload boundary from the user-owned
  `~/.vorkflo/models.json`. No provider model list is compiled into the desktop
  application.

## Integration assumptions

- A direct executable name requires an explicit environment binding such as
  `PATH: { source: 'host', name: 'PATH' }`. New process blocks include this
  binding and the authority review displays it.
- Only environment names declared by the workflow are resolved from the host.
  Literal environment values are portable and therefore must not contain
  secrets.
- The execution coordinator emits the canonical state/event stream. The desktop
  runtime adapter only projects those events into UI snapshots.
- Workflow file reads are structurally parsed in the Electron main process.
  Semantic validation remains visible in the editor, blocks the Run action, and
  is repeated in the main process before execution authority is granted.

## Commands

```sh
npm run dev --workspace @vorkflo/desktop
npm run build --workspace @vorkflo/desktop
npm run test --workspace @vorkflo/desktop
npm run package:mac:unsigned
npm run release:mac
npm run desktop:smoke:packaged
npm run desktop:performance:packaged
```

Unsigned release policy, artifact verification, installation, workflow trust,
and uninstallation are documented in
[`docs/release/MACOS.md`](../../docs/release/MACOS.md).
