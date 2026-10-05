# Task Progress: Budget backup, validation, restore, and isolated comparison

Current status: completed locally on Windows
Current phase: all A1-A3 verified. Linux/distribution and personal adoption remain later roadmap tasks.

## Dependencies

[0011-cli-budget-lifecycle](../0011-cli-budget-lifecycle/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md)

## Human input required

None to review this planned contract. The user authorized CLI implementation. Lifecycle and synchronization prerequisites now have Windows acceptance proofs. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add API-backed backup create plus manifest/hash handling; validate file completion before declaring success.
- [x] Add validation and restore-as-new using lifecycle isolation; return differences from two explicit budget identities.
- [x] Add bounded retention and clear documentation that an encrypted sync budget does not imply an encrypted exported archive.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                 | Evidence                                                                                                                                                      | Status           |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A1  | Cash balances, transactions, rules, schedules, allocations, reservations settings, and cashPlanning round-trip through a backup. | Rich encrypted fixture in integration/backups.test.mjs                                                                                                        | Verified locally |
| A2  | Corrupt/truncated archives fail validation and preserve the original and existing backup.                                        | Hash mismatch and matched-hash corrupt ZIP; original archive/manifest and independent remote accounts preserved                                               | Verified locally |
| A3  | Restore-as-new and comparison generate no original-budget writes or remote overwrite; retention keeps the newest valid backup.   | Packaged restore/compare prove source/archive/remote preservation; retention keeps newest valid artifacts per source, preserving corrupt and linked artifacts | Verified locally |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-03: Added public restoreBudget and CLI backups restore. Canonical import creates a new ID and exclusive directory, resets identity metadata through the shared clone owner, and skips upload. All ten checks pass: 40 API tests, 29 core fixture/ZIP tests, 214 CLI tests, root types, CLI/API/server/browser builds, 18 packaged integration tests, lint, and formatting. Evidence: verification-restore-2026-10-03.json. Packaged restore proves rich round-trip, repeated copies, fresh cache, cancellation, invalid mode/name, editing isolation, original metadata/archive preservation, and remote inventory preservation. Comparison and retention remain; no user input is required.

- 2026-10-03: Listing and isolated validation pass all seven focused regression checks: 214 CLI tests, root types, CLI/API dependency build, server build, 17 packaged integration tests, lint, and formatting. Evidence: verification-validation-focused-2026-10-03.json. The rich source/import snapshots match all named A1 domains. Corruption, unsafe manifest paths, and wrong identity fail without source/backup changes. Cancellation was red before its signal handling, then proved worker closure precedes temporary-directory removal. Restore, comparison, and retention remain. No user input is required.
- 2026-10-03: An incorrect verifier task argument selected root fallback checks and exposed two core fixture cleanup failures on Windows. The nested teardown deleted an open SQLite file before the outer close hook. main.test.ts now closes the budget first; all eight focused core tests pass. The broader suite was not rerun. Evidence: verification-validation-2026-10-03.json and verification-core-main-fixed-final-2026-10-03.txt. Subsequent verifier calls use the task basename explicitly.
- 2026-10-03: Final root typecheck passes after the cleanup correction. Packaged cancellation with stdin cancel also passes in verification-packaged-cancel-2026-10-03.txt. Rebuilt CLI dependencies and sync-server after typecheck; git diff --check passes. Next implement restore-as-new at the canonical new-identity owner, then comparison and retention. The full CLI goal remains active.

- 2026-10-03: Atomic backup creation and source/freshness/hash manifest implemented through the public export API. The test was red before the command existed, then proved two plaintext artifacts from an encrypted source, no overwrite, complete hashes, and unchanged independent remote accounts. All seven creation checks passed, including 212 CLI tests and 16 packaged integration tests. Evidence: verification-create-2026-10-03.json. Next add listing and isolated engine validation; restore/compare/retention remain. No user input is required.

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.

- 2026-10-03: Comparison and retention implemented. All four focused packaged backup cases pass; partial deletion unit proof passes. Comparison preserves source/remote state and reports bounded differences. Retention keeps the newest valid artifact per source, preserves corruption and external links, and requires explicit apply. Final restore-profile regression is running; complete only after its ten checks pass. Next record that result and release the mutation prerequisite hold.

- 2026-10-03: Final verification-complete-2026-10-03.json passes all ten checks: 40 API tests, 29 core fixture/ZIP tests, 216 CLI tests, root types, CLI/API/server/browser builds, 19 packaged integration tests, lint, and format. A1-A3 are verified locally on Windows. Task 0013 is complete locally and task 0014 is ready for review. git diff --check passes. Changes remain uncommitted and unpublished; the full CLI goal remains active.
