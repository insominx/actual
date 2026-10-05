# Implementation: 0022 cli-reconciliation

## Slice 1: core status

- Core `server/accounts/reconcile.ts`: `reconciliationStatus` (D2, D3). Handler `api/reconcile-status`; public `getReconciliationStatus` and types `ReconciliationStatus*`; CLI `reconcile status <account> [--balance --date]` (read, D7).

## Slice 2: finish

- Guarded `reconcile.finish` (D4): types `ReconcileFinishRequest|Proposal|Outcome`; handlers `api/reconcile-preview-finish`, `api/reconcile-finish`; public `previewReconcileFinish`, `applyReconcileFinish`; CLI `reconcile finish <account> --balance [--date] --ids --operation-id`.

## Slice 3: adjustment and unlock

- Guarded `reconcile.adjust` (D5): types `ReconcileAdjust*`; handlers `api/reconcile-preview-adjust`, `api/reconcile-adjust`; public `previewReconcileAdjust`, `applyReconcileAdjust`; CLI `reconcile adjust <account> --amount [--date] --operation-id`.
- Unlock: existing `transactions clear --unlock` (D6).
- Docs: `cli.md` Reconcile section, README row, `upcoming-release-notes/agent-cli-reconcile.md`.

## Verification (Linux)

| Check    | Command                                                              | Result                                                                         |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| API      | `yarn workspace @actual-app/api exec vitest run -t "reconciliation"` | 1/1                                                                            |
| CLI unit | `yarn workspace @actual-app/cli test`                                | 311/311                                                                        |
| Types    | loot-core, API and CLI `tsc`                                         | clean                                                                          |
| Packaged | `node --test integration/reconciliation.test.mjs`                    | 7/7 (`verification-reconciliation-linux.txt`, run together with the 0025 file) |

Acceptance mapping:

- A1: on an account with a split, a transfer, a deposit, a pending row and a later row, `reconcile status` equals the app's cleared sum of top-level rows (split counted once); finishing locks the parent and both split children and the transfer row, but not the transfer counterpart in the other account.
- A2: `--date` excludes the later row from balance and candidates (`clearedAfterCutoffCount` 1); a nonzero difference and a short candidate list are refused; a preview made stale by clearing another row is rejected with `STALE_PREVIEW`.
- A3: an adjustment receipt adds exactly one cleared "Reconciliation balance adjustment" row and changes no other table; a zero adjustment is refused; a reconciled row cannot be changed without `--unlock`; after unlock and `sync`, `lastReconciled` is still set and the unlocked row is a candidate again. Kill points before engine, after engine and before sync keep their outcome for adjustments (guarded-kit).

Limitations: Windows not run. The desktop client still uses its own reconciliation helper (D2); browser parity is shown by equal definitions and the packaged comparison with the app's sum, not by a browser run. Closed-account and future-date refusals are covered by code paths, not packaged fixtures.

Decision audit: D1-D7 in execution-decisions.md.
