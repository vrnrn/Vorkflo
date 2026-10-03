# Repository guidance

Read `VISION.md` before changing product scope or execution semantics.

## Working rules

- Keep the orchestration engine independent of desktop and web UI code.
- Model generic processes, artifacts, and runtime events; do not add
  provider-specific behavior to the engine.
- Preserve the v0.1 DAG constraint unless a new vision decision supersedes it.
- Treat workflows as executable code. Direct executable-and-argument invocation
  is the default; shell evaluation must remain explicit.
- Keep secrets out of fixtures, workflow definitions, logs, and committed `.env`
  files.
- Add or update tests for every contract or semantic validation change.
- Do not execute real user tools, network calls, or ambient shell commands in
  unit tests.
- Run `npm run verify` before considering a change complete.

## Structure

- `packages/engine` owns portable workflow contracts, validation, scheduling
  semantics, runtime events, and the process-runner interface.
- Desktop runtime adapters and UI packages must depend inward on the engine. The
  engine must never depend on them.
- Product decisions belong in `VISION.md`; implementation rationale belongs in
  `docs/architecture` or a future decision record.
