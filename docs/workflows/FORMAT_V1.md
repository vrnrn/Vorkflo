# Workflow format v1

Vorkflo workflow files are UTF-8 JSON documents. The engine parses them with a
strict schema: unknown fields are rejected so misspellings do not silently
change execution authority.

Use `.vorkflo.json` as the file suffix. A complete example lives at
`examples/workflows/hello-report.vorkflo.json`.

## Top level

```json
{
  "schemaVersion": 1,
  "id": "hello-report",
  "name": "Hello report",
  "blocks": [],
  "connections": [],
  "layout": { "blockPositions": {} }
}
```

`layout` is optional and never changes execution semantics. Block and connection
IDs must be unique. Connections must form a directed acyclic graph.

## Process invocation

Every v1 block has `kind: "process"`. An invocation declares its executable,
arguments, working directory, environment bindings, optional stdin input, shell
mode, and output bindings.

Arguments are explicit values rather than one command string:

```json
"arguments": [
  { "type": "literal", "value": "--format" },
  { "type": "input", "portId": "source-file" }
]
```

Direct execution is the default. `"shell": true` deliberately opts the block
into shell interpretation and is highlighted by the desktop run preview.

## Environment bindings

Workflow files declare how each child environment variable is resolved:

```json
"environment": {
  "PATH": { "source": "host", "name": "PATH" },
  "MODE": { "source": "literal", "value": "summary" },
  "INPUT": { "source": "input", "portId": "payload" }
}
```

Host bindings store only the variable name. The host value is resolved at run
time and is never written back into the workflow file. New blocks explicitly
inherit `PATH`; Vorkflo does not silently inherit the entire host environment.

## Ports and artifacts

Input and output ports declare one of three artifact kinds:

- `text`
- `json`
- `filesystem-reference`

Connected ports must use the same kind. Each required input has exactly one
incoming connection and must be bound to an argument, stdin, or environment
variable.

Text and JSON outputs bind to stdout. JSON is parsed after the process exits and
invalid JSON is a typed block failure. A filesystem output declares a path and
produces a reference only after the runner verifies that the file or directory
exists and matches any declared entity type.

## Validation and execution

Run the repository checker before importing a hand-edited workflow:

```sh
npm run workflow:check -- examples/workflows/hello-report.vorkflo.json
```

Structural parsing happens again in the Electron main process before file
writes. Semantic validation happens again before execution. Invalid drafts may
be saved, but they cannot run. A valid file is still executable code and must be
reviewed before running if it came from another person.
