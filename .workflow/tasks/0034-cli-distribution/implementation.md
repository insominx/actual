# Implementation: 0034 cli-distribution

## Slice 1: packed-artifact smoke tests and version diagnosis

- `integration/distribution.test.mjs` packed case (opt-in `ACTUAL_TEST_PACKED=1`): `yarn pack` of `@actual-app/api` and `@actual-app/cli`, npm install of both tarballs into a clean directory with spaces in its path, then capabilities, schema, server bootstrap, context and the bash tutorial through the installed binary (D2).
- `packages/cli/src/upgrade-check.ts` and `commands/upgrade.ts`: `actual upgrade check [--server]` (read-only; D3, D4).

## Slice 2: documentation

- `cli.md` "Installation, upgrades and tutorials" section: Node and native-module requirements, secrets, first run, upgrade check and preserved state (D6); README `upgrade` row; `upcoming-release-notes/agent-cli-distribution.md`. Earlier sections already document offline/sync, previews, error codes, recovery and cash workflows.
- `packages/cli/examples/first-run.sh` and `first-run.ps1` (D5).

## Slice 3: migration fixtures and evidence

- Future-version receipt and run fixtures in the A3 test and `src/upgrade-check.test.ts`; no migration code because every store is at version 1 (D4).

## Verification (Linux)

| Check    | Command                                                              | Result                                        |
| -------- | -------------------------------------------------------------------- | --------------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`                                | 333/333 (adds `src/upgrade-check.test.ts`, 2) |
| Types    | CLI `tsc --noEmit`                                                   | clean                                         |
| Packaged | `ACTUAL_TEST_PACKED=1 node --test integration/distribution.test.mjs` | 3/3 (`verification-distribution-linux.txt`)   |

Acceptance mapping:

- A1: packed API and CLI tarballs install with npm into `actual packed */clean install`; the installed binary lists more than 150 operations, returns the `imports.preview` schema, bootstraps a disposable server, answers `context`, and runs the bash tutorial (offline budget setup, CSV intake, stdin JSON transaction, backup) with its data in `packed data`.
- A2: the bash tutorial runs from `tutorial dir/with spaces` with JSON through an argument (setup spec), files (manifest, CSV with a quoted comma) and stdin (a payee with an apostrophe and double quotes); the resulting budget holds the three expected amounts and payees and one backup. The PowerShell tutorial was not executed (no PowerShell on this host; D5).
- A3: `upgrade check --server` reports a compatible state with one version 1 workflow run, absent jobs and the server release line; after adding a version 2 receipt and run it reports `compatible: false` with "does not read ... nothing was changed" actions, `workflow run inspect` on the newer run fails with exit 2, and the data directory digest is unchanged.

Windows rerun pending (Windows install, PowerShell tutorial and Task Scheduler).
