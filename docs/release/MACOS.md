# Install Vorkflo on macOS

The supported download is for Apple silicon (M1 or later), on macOS 12 or later.
Intel Macs, Windows, and Linux do not have supported packaged releases yet.

## Verify the download

Download a DMG or ZIP and `SHA256SUMS.txt` from the same GitHub release. In the
folder containing those files, compare the downloaded artifact's SHA-256 value
with its entry in the manifest:

```sh
shasum -a 256 Vorkflo-0.4.0-mac-arm64.dmg
```

If both listed artifacts are present, `shasum -a 256 -c SHA256SUMS.txt` checks
both at once. A checksum verifies file consistency; it is not a publisher
signature.

## Install and open

1. Open the DMG and drag **Vorkflo** to **Applications**, or extract the ZIP and
   move **Vorkflo.app** there.
2. Launch Vorkflo from Applications.
3. If macOS blocks it, open **System Settings → Privacy & Security** and choose
   **Open Anyway** for Vorkflo, then confirm the application you downloaded.

This release has no Developer ID signature or Apple notarization. If macOS
instead reports that the verified application is damaged and offers no override,
remove the quarantine attribute from this application only:

```sh
xattr -dr com.apple.quarantine /Applications/Vorkflo.app
```

Use that command only after verifying the download and deciding to trust it. Do
not disable Gatekeeper globally.

## Local tools and data

Ordinary process workflows use tools already installed on the Mac. Agent blocks
require their selected CLI and its own authentication. Computer Use additionally
requires Node.js 22.12 or later, Codex, a dedicated local profile, and a
reviewed MCP manifest. Vorkflo packages its helper scripts; a source checkout is
not needed. See [Computer Use setup](../workflows/COMPUTER_USE.md).

Workflow files live wherever you save them. Run history and unsaved drafts are
local application data. History is retained for up to 30 days with a 100 MiB
application limit; oldest runs are pruned first. Machine-local model preferences
are read from `~/.vorkflo/models.json`.

## Remove the application

Quit Vorkflo and move `/Applications/Vorkflo.app` to the Trash. To remove local
application history and drafts, also remove
`~/Library/Application Support/Vorkflo`. Your saved workflows and external CLI
settings remain separate. Review any run-scoped Git worktrees before deleting
application data; they may contain work you want to keep.
