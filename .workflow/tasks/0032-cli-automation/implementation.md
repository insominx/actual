# Implementation: 0032 cli-automation

## Slice 1: saved job config and run-once entry

- `packages/cli/src/jobs.ts`: job records in `jobs/<name>/job.json` (budget binding, `intake` workflow, inbox/processed/error directories, filename routes, allowed mutations, cross-account policy, stability window, enabled flag), validation before any side effect, and `runJob` over the 0031 workflow runner (D2, D3, D11).
- `packages/cli/src/commands/jobs.ts`: `jobs create|list|status|run|disable|enable|schedule`.

## Slice 2: stable files, overlap locks, hashes and directory boundaries

- Inbox scan: temporary download names and recently modified files stay `pending-unstable`; unrouted files stay `no-route`; content hash plus account plus settings dedupes against the job ledger (`duplicate` moves to processed without an import); identical content for another account stays `cross-account-review` without the policy (D4, D5, D6).
- Moves only between the declared, distinct, non-nested directories (D7). Per-job lock; the active run is recorded before it starts and resumed by the next invocation (D8). `--dry-run` previews each ready file and planned moves (D9).

## Slice 3: scheduler recipes and local results

- Each run writes a local JSON result under `jobs/<name>/results/` (`resultPath`, `jobs status`); no external delivery (D10).
- `jobs schedule` prints cron, systemd timer and Windows Task Scheduler recipes and installs nothing (D10).
- Wiring: `#jobs` import, program registration, `jobs.status` and `jobs.schedule` read operations, `integration/jobs.test.mjs` in `test:integration`. `createRun` was extracted in `workflows.ts` for reuse.
- Docs: `cli.md` Automation jobs section, README row, `upcoming-release-notes/agent-cli-automation.md`.

## Verification (Linux)

| Check    | Command                                 | Result                                    |
| -------- | --------------------------------------- | ----------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`   | 327/327 (adds `src/jobs.test.ts`, 2)      |
| Types    | CLI `tsc --noEmit`                      | clean                                     |
| Packaged | `node --test integration/jobs.test.mjs` | 1/1 (`verification-automation-linux.txt`) |

Acceptance mapping:

- A1: a routed stable file imports once (two rows); a `.part` file and a just-written file stay pending; an unrouted file stays in the inbox; the same content again moves to processed as `duplicate` with no new rows; the same content routed to another account stays `cross-account-review` and imports nothing.
- A2: two simultaneous `jobs run` invocations produce one run with one import; the other fails with retryable `job-active` (or finds nothing left). A run paused after its first import, rewritten to the pending state a crash leaves, is resumed by the next `jobs run`, which replays the receipt (no duplicate row), imports the second file and moves both.
- A3: `--dry-run` reports the planned import (two adds) and pending files with no ledger change; `jobs disable` makes `jobs run` fail with exit 2 and leaves new inbox files untouched; the cron and Windows recipes are printed and the printed command arguments run successfully on Linux. Windows Task Scheduler execution is pending a Windows rerun.
