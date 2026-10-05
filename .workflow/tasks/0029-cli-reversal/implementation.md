# Implementation: 0029 cli-reversal

## Slice 1: inverse capability and preview

- `packages/cli/src/reversal.ts`: `planReversal` (per-operation inverse from receipt before-values, D2, D4-D7), `REVERSIBLE_COMMANDS` for discovery (D9). CLI `changes reverse <original-id> --operation-id <new-id> --preview` prepares the inverse as a normal guarded receipt.

## Slice 2: postconditions and compensating apply

- `reversalConflicts` compares the prepared inverse with the original after-values (D3); `changes reverse` without `--preview` applies through the shared executor with the new receipt identity; retries with the same new ID return the same receipt.

## Slice 3: recovery diagnosis

- `diagnoseReceipt` and `changes inspect <operation-id>` (D8): state meaning, safe next steps, reversal plan, and backup recovery steps (`backups list`, `backups restore` into a new budget, `budgets compare`).
- Docs: `cli.md` Reversal and recovery section, `upcoming-release-notes/agent-cli-reversal.md`.

## Verification (Linux)

| Check    | Command                                     | Result                                  |
| -------- | ------------------------------------------- | --------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`       | 320/320 (adds `reversal.test.ts`)       |
| Types    | CLI `tsc`                                   | clean                                   |
| Packaged | `node --test integration/reversal.test.mjs` | 3/3 (`verification-reversal-linux.txt`) |
| API      | not changed                                 | no public API change (D2)               |

Acceptance mapping:

- A1: a two-row categorization is reversed to the rows' prior (empty) category while a later, unrelated categorization of another row stays; an allocation move is reversed through `--preview` then `changes apply`, restoring both budgeted amounts; a `set-target` save is reversed to the earlier saved plan.
- A2: a second reversal of the same change, an amount edited after categorization, and a budget-boundary transfer leg changed through its counterpart are refused with `STALE_PREVIEW` and conflicts; a row reconciled since is refused; none of these rows change.
- A3: retrying `changes reverse` with the same new ID returns the identical receipt without a second write; merge and delete receipts are refused with backup recovery steps and `changes inspect` reports `reversal.supported: false`; a prepared-but-unapplied receipt is refused as never applied; an uncertain receipt is never reversed and its diagnosis lists recovery steps without a reverse command (unit test).

Limitations: Windows not run. An uncertain receipt is covered by the unit test, not a packaged kill-point run. Reversal sync outcome follows the shared executor (committed-local, then sync as for any guarded change).

Decision audit: D1-D9 in execution-decisions.md.
