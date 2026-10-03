# 0001: Electron desktop runtime

- **Status:** Accepted
- **Date:** 2026-07-09
- **Vision decision:** VOR-009

## Context

Vorkflo v0.1 needs a desktop canvas, local workflow files, process execution,
cancellation, and live runtime events. The engine and runner contracts are
already TypeScript. Leaving the runtime undecided would prevent a complete
vertical slice and push authority decisions into ad hoc application code.

## Decision

Use Electron for v0.1.

- The main process owns filesystem dialogs, workflow persistence, and execution.
- The renderer owns visual editing and presentation only.
- Node integration is disabled in the renderer.
- Context isolation is enabled.
- A preload script exposes a narrow, typed bridge for the operations Vorkflo
  needs; it does not expose raw IPC or Node primitives.
- The main process parses and validates renderer-supplied workflow data again
  before saving or executing it.

## Consequences

The first release stays within one language and can integrate the local process
runner directly. The application accepts Electron's distribution footprint for
v0.1. A future runtime change remains possible because workflow semantics and
execution coordination live outside the desktop package.
