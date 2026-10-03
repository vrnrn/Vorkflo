# `@vorkflo/node-runner`

The Node runtime adapter for Vorkflo's UI-independent process runner contract.
It launches direct executable-and-argument invocations by default and only
enables shell interpretation when `shell: true` is explicit in the request.

The runner does not inherit the ambient environment: callers must supply every
environment variable a process may use. Relative output paths resolve against
the requested working directory (or the runner process directory when none is
declared).

Output bindings come from the engine's `ProcessRunRequest`. The adapter converts
declared stdout, stderr, and filesystem outputs into provenance-bearing
artifacts for validation and routing by the engine.
