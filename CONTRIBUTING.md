# Contributing to Vorkflo

Start with [VISION.md](VISION.md) and [AGENTS.md](AGENTS.md). Keep the engine
independent of the desktop, and put product-specific integrations in adapters.
Workflows remain DAGs with direct executable-and-argument invocation by default.

## Local development

Use Node.js 22.12 or later and npm 11 or later. Run `npm ci`, then
`npm run dev`. Before submitting a change, run `npm run verify`, which also
builds the workspace dependencies from a fresh checkout. Runtime or packaging
changes also need `npm run desktop:smoke:packaged`; canvas performance changes
need `npm run desktop:performance:packaged`.

Add or update tests whenever a contract or validation rule changes. Use
synthetic fixtures and controlled fake runtimes; unit tests must not call user
tools, account services, or ambient shell commands. Keep comments focused on
contracts, authority boundaries, and decisions that are not obvious from the
code.

## Sharing a change

Describe the problem, resulting behavior, and validation. Include a screenshot
for a visible UI change, using synthetic data and the application viewport only.
Never include credentials, private workflows, personal paths, raw run history,
or account screenshots in issues, pull requests, or test fixtures.

`npm run audit:public` checks common credentials, personal emails, home paths,
and private file names. It cannot determine whether arbitrary content is
proprietary. Review new text, image pixels, generated files, and commit metadata
before publishing.

## Release process

The [Quality workflow](.github/workflows/ci.yml) verifies source and exercises a
packaged application on macOS. The
[Release workflow](.github/workflows/release.yml) runs the same checks, builds
DMG/ZIP downloads, verifies their payloads, and publishes their checksums.
Actions are pinned to exact commits, and only the publication job receives
repository write permission.

Update the root and desktop versions together, add `docs/release/<version>.md`,
then push a matching `v<version>` tag. A manual release can be dispatched from
`main`. Published versions are immutable; use a new version for corrections.
