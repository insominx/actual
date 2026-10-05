# Implementation: 0031 cli-workflows

## Slice 1: run store and intake

- `packages/cli/src/workflow-runs.ts`: device-local run records in `workflow-runs/<run-id>.json` (budget, validated input, fixed step plan, step outcomes, operation IDs, unresolved items, artifacts), atomic writes, listing and a per-run lock (D3, D9).
- `packages/cli/src/workflows.ts`: input validation before side effects, fixed step plans, the executor (`advanceRun`, `cancelRun`, `runSummary`) and the step implementations (D2). Intake: one `imports.file` guarded change per manifest file bound to the SHA-256 observed at run start, then `transfers` (transfer candidates over the imported date ranges) and `review` (data-quality checkup with saved statement evidence) (D6).

## Slice 2: setup, weekly checkup, monthly close, goal review

- Setup: optional `budgets.create` (offline, D5), then `accounts.create`, `category-groups.create` and `categories.create` per item.
- Weekly checkup: data quality, schedules due in seven days, bank sync status; read-only (D10).
- Monthly close: optional backup artifact (`createBudgetBackup`, extracted from `backups create`), per-statement reconciliation status, `reconcile.finish` only with `--finish` and a zero difference with the candidate set frozen into the step payload, then a data-quality review with the supplied statements; `summary.closeComplete` (D4, D6).
- Goal review: saved plan and transient scenario side by side; read-only (D7).

## Slice 3: resume, cancel and receipt links

- `commands/workflow.ts`: `workflow setup|intake|weekly-checkup|monthly-close|goal-review` with `--run-id` and `--stop-after`, and `workflow run list|inspect|resume|cancel`. Committed steps are never re-executed; an interrupted mutation replays its receipt (D3, D8). `summary.operations` lists committed operation IDs for `changes inspect <operation-id>`.
- Wiring: `#workflow-runs` and `#workflows` imports, program registration, read operations in `agent-contract.ts`, `integration/workflows.test.mjs` in `test:integration`.
- Docs: `cli.md` Workflows section (including one-run authorization), README row, `upcoming-release-notes/agent-cli-workflows.md`.

## Verification (Linux)

| Check    | Command                                      | Result                                    |
| -------- | -------------------------------------------- | ----------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`        | 325/325 (adds `src/workflows.test.ts`, 4) |
| Types    | CLI `tsc --noEmit`                           | clean                                     |
| Packaged | `node --test integration/workflows.test.mjs` | 2/2 (`verification-workflows-linux.txt`)  |

Acceptance mapping:

- A1: on a freshly bootstrapped disposable server, `workflow setup` creates a budget, two accounts, a group and two categories (six committed guarded changes); `workflow intake` imports two CSV files into two accounts and reviews them (transfer candidate and uncategorized rows unresolved, no month claimed statement-verified); `workflow monthly-close --finish --backup-directory` writes a backup artifact, reconciles and reports `closeComplete: true`, with the receipt readable through `changes inspect`. No browser is used.
- A2: an intake paused after its second import, with that step rewritten to the pending state a crash leaves, resumes without new rows (`wf-resume1-import-1` receipt replayed) and finishes the review steps; resuming a finished run is rejected. A cancelled intake keeps its first import committed and marks the rest `not-run`; resuming it is rejected.
- A3: a close with one unmatched statement reconciles the other account, leaves the unmatched one unreconciled and reports `closeComplete: false` (`needs-review`); `workflow goal-review` with a scenario leaves `cash-planning inspect` saved output identical.
