# Backup implementation record

Last Edited: 2026-10-03

Status: completed locally on Windows. Creation, listing, isolated validation, restore-as-new, comparison, and retention are implemented and verified.

## Contract and ownership

Source: plan.md. backups create uses public inspectBudget, getSyncStatus, and exportBudget through the existing connection. Canonical Actual export owns the archive. CLI backup-artifacts.ts owns paths, staging, manifest/hash writes, and completed-directory publication. No direct database access or finance formula was added.

The explicit backup root is resolved before creating a uniquely named staging directory. Files use exclusive creation, are flushed, and are reread for completion/hash checks. A rename publishes one completed artifact directory. Cleanup targets only the exact staging directory created under that root; incomplete cleanup reports partial completion rather than inviting blind retry. The operation preserves earlier artifacts and returns context commit none because no ledger mutation occurs.

The archive is plaintext. The version 1 manifest records source identities, name, currency, source encryption, artifact encryption, creation time, engine checkpoint, pending messages, last observed sync timestamp, and unknown offline freshness. validation not-imported prevents conflating byte verification with isolated engine import validation.

## Decision audit

See execution-decisions.md D1-D10. Canonical core import gained a new-identity path and shares identity reset with cloning. No archive format changed. The artifact manifest is not a mutation receipt.

## Verification checkpoint

The packaged creation test failed before backups create existed. It then passed against an encrypted remote source: two complete plaintext backups, correct bytes/hash and source identity, original artifact retained, no staging entries left, and unchanged accounts in an independent remote reader. Root typecheck and CLI/API dependency build passed. CLI unit tests passed 212 cases, including validation of a blank backup directory before API access.

The first targeted lint run found one named-import ordering issue in the new test; it was corrected. Final sequential verification is recorded in verification-create-2026-10-03.json.

Final creation verification passed all seven checks: 212 CLI tests, root typecheck, CLI/API dependency build, packaged server build, 16 packaged integration tests, targeted lint, and formatting. The creation test confirms sourceEncrypted true while artifact encrypted is false. This proves the creation checkpoint; it does not prove restore or full A1-A3 backup acceptance.

## Acceptance and limits

| Check | State            | Remaining                                                                                                                                                                       |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | Verified locally | Rich encrypted fixture source/import snapshots match, including balances, split/transfer transactions, rules, schedules, allocations, reservations and cashPlanning preferences |
| A2    | Verified locally | Hash mismatch and matched-hash truncated ZIP fail; original artifact bytes and independent remote accounts stay unchanged                                                       |
| A3    | Verified locally | New IDs, comparison isolation, source/archive/remote preservation, newest valid per-source retention, cancellation and partial deletion                                         |

## Resume

Continue with task 0014 plan review. Ordinary importBudget still preserves an archive's local ID; restoreBudget is the supported new-identity owner. Do not publish restored budgets or use personal data. No user input is required for synthetic implementation. Changes remain uncommitted.

## Listing and validation checkpoint

backups list reads only version 1 manifests and returns total, limit, and truncated. Its not-validated status does not claim hash or engine verification. backups validate rejects invalid manifests, symbolic links, unsupported artifact file names, oversize/mismatched archives, wrong hashes, and source identity mismatch. The child receives only private paths over stdin and no Actual environment/configuration. Public importBudget owns ZIP interpretation. Public queries and getAccountBalance produce the normalized domain snapshot. Successful isolated inspection requires cleared remote/encryption identity.

budget-snapshot.ts pages curated public tables in 1000-row batches, includes deleted rows and all splits, and returns row counts and deterministic SHA-256 fingerprints. It does not reproduce ledger calculations or claim exhaustive physical database integrity. backup-validation.ts applies a worker deadline and waits for closure before cleanup. The command handles SIGINT, SIGTERM, and a cancel line on stdin. The cancellation test mocks only child_process and verifies the real temporary directory exists until closure and is removed afterward.

Focused packaged tests pass two cases: creation from an encrypted source and rich round-trip/corruption/boundary validation. The validation case was initially red before registration; subsequent failures exposed worker stdout logs and the test's omission of the closed account. The test now explicitly includes closed accounts rather than weakening domain coverage. Blank listing input and cancellation tests were red before their implementation and are now green.

All seven configured checks pass in verification-validation-focused-2026-10-03.json: 214 CLI tests, root typecheck, CLI/API dependency build, server build, 17 packaged integration tests, targeted lint, and formatting. This verifies the listing/validation checkpoint and A1-A2 locally; A3 is open.

An earlier verifier call passed a path instead of a task basename, causing fallback to root typecheck/test. Its broad suite exposed two Windows cleanup failures in core main.test.ts. Nested teardown tried to delete db.sqlite before the outer close hook. The fixture now closes the budget before deletion. Eight focused core tests pass in verification-core-main-fixed-final-2026-10-03.txt. The broad suite was not rerun; its recorded failure is not a backup acceptance result. This is a fixture cleanup correction with no production behavior change.

Final root typecheck passes after the test-only cleanup correction. Packaged cancellation is also verified through the CLI with a cancel line on stdin, alongside source preservation checks; both focused backup tests pass in verification-packaged-cancel-2026-10-03.txt. Root typecheck can overwrite API/server executable outputs with TypeScript emit. Rebuild CLI dependencies and sync-server after typecheck before running packaged fixtures. The final working tree has rebuilt executables and no whitespace errors in git diff --check.

## Restore-as-new checkpoint

Public restoreBudget accepts Actual archive bytes and a unique name. api/restore-budget rejects an API instance configured with a server and validates the name before closing the selected budget. importActual passes the new name to importBuffer, which creates an exclusive new directory using idFromBudgetName. Shared newBudgetMetadata clears remote, encryption, publication, archive, and sync checkpoint metadata and resets the clock. Existing clone semantics use the same helper. Default importBudget retains its original ID behavior.

The importer clears engine caches, loads the new budget offline, waits for calculation, and skips upload. Partial write failures remove only the newly created directory. Failed exclusive creation never permits removal. Invalid SQLite failures close any engine/database handle before removing the restore-owned directory directly. The usual delete-budget helper attempts to open a database and is unsuitable for corrupt SQLite cleanup. Incomplete cleanup reports creation-cleanup-failed.

backups restore validates the manifest/hash/source identity and isolated domain queries before opening the destination. It requires --offline and a unique name, acquires the lifecycle lock, creates the budget through the public API, and returns inspection plus the domain snapshot. The lock survives shutdown. Cancellation before writing leaves no copy. Once writing starts, the core finishes or cleans up. Failed final inspection returns partial completion with the new ID. The CLI translates invalid names and incomplete cleanup to the existing error contract; no competing receipt format was added.

The packaged restore test was red before the command existed. It now proves two independent IDs, full rich snapshot equality, reopening, editing only one restored copy, a fresh destination cache, duplicate-name rejection, online rejection, cancellation, original metadata/archive preservation, unchanged independent remote accounts, and unchanged remote budget inventory. API tests pass 40 cases, including restore identity/source preservation, invalid ZIP and SQLite cleanup, injected write failure, and an exclusive creation failure with no cleanup calls.

All ten restore checks pass in verification-restore-2026-10-03.json: 40 API tests, 29 core fixture/ZIP tests, 214 CLI tests, root types, CLI/API dependency build, server build, browser build, 18 packaged integration tests, lint, and formatting. Browser build proves the shared core changes compile for that target; browser restore UI behavior is not claimed. This earlier restore checkpoint left A3 partial; the final comparison/retention verification below closes A3.

## Comparison and retention checkpoint

budgets compare exports two explicit local IDs through public API connections and inspects each archive in a private worker. It returns domain fingerprint differences and canonical account balances, with bounded results, separate observation times, and unknown remote freshness. No name-based entity matching or finance formulas were added. The rich restore fixture now proves equality before an edit, differences and truncation after an edit, missing-budget rejection, and source/archive/remote preservation.

backups prune imports eligible archives before choosing the newest valid keepers per source ID. Inspection is a dry run; --apply computes a fresh policy. The inventory limit rejects incomplete enumeration. Creation and retention share the backup root lock. Path checks reject links and extra files. Apply rechecks all valid artifacts before deletion and deletes only the two managed files and the empty artifact directory. Partial deletion returns completed and active paths.

All four focused packaged backup tests passed before final regression. The new retention fixture proves per-source keepers, preservation of a newer corrupt archive with matching forged hash, preservation of an external junction, cancellation and bounded-inventory rejection before deletion, and unchanged independent remote accounts. A focused unit test injects manifest unlink failure after archive deletion and proves PARTIAL_COMPLETION plus keeper preservation. Its lint errors were corrected using a normal type import and a guarded cleanup helper. Final regression is running under the restore profile; no completion claim is made before that process finishes.

New owners: budget-comparison.ts, backup-retention.ts, backup-retention.test.ts. Command registration, bounded schema discovery, cancellation handling, pure stableJson ownership, README, API CLI docs, and release notes were updated. Retention uses artifact policy outcomes, not the future mutation receipt schema. Windows is the current verification platform. Linux/distribution/personal adoption remain later roadmap tasks.

## Final verification and continuation

verification-complete-2026-10-03.json passes all ten restore-profile checks, including 216 CLI tests and 19 real packaged integration tests. The 40 API and 29 core fixture/ZIP tests also pass. Root typecheck and CLI/API/server/browser builds pass. Targeted lint and formatting pass. git diff --check passes. This verifies A1-A3 locally on Windows. The browser build checks compilation of shared core changes; no browser restore UI claim is made. Domain fingerprints cover the named tables rather than exhaustive physical SQLite integrity.

Task 0014 may now proceed to review and implementation. There are seven complete local CLI tasks and 23 remaining roadmap tasks. No personal data was used. No commit, publication, Linux verification, or full CLI completion is claimed. The existing repository-wide baseline limits remain separate. The checkpoint is this evidence file plus the current uncommitted worktree; do not roll back unrelated changes.
