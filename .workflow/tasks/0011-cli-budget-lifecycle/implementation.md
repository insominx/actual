# Implementation Record

## Publication, rename, and archive checkpoint — 2026-10-03

Status: completed locally on Windows. Linux and browser interoperability remain final CLI acceptance work.

The public API now publishes a selected local budget explicitly. Encrypted first publication requires the server capability and registers its encrypted payload and key test together. A retained prepared identity makes accepted-but-unacknowledged uploads recoverable. Wrong-server retries fail. Published identities are not silently recreated when absent remotely. See execution-decisions.md D7-D10.

Rename uses the canonical synced preference writer. Archive is a reversible device-local marker, visible in inventory and omitted from exports/clones. No remote deletion occurs. Creation and clone failures clean incomplete local files or report cleanup failure explicitly.

A1-A3 pass locally: usable local creation, clone isolation, cleanup and duplicate validation, stable publication metadata, lost-response recovery, restart with an encrypted independent reader, wrong password, and independent observation of rename/archive behavior. Three packaged lifecycle tests cover these outcomes. Remaining platform coverage belongs to final CLI acceptance.

The final combined evidence is ../0012-cli-sync/verification-2026-10-03.json: all ten checks passed, including 37 API tests, 210 CLI tests, 74 focused server tests, ten packaged integration tests, root typecheck, CLI/API/server/browser builds, targeted lint, and formatting. The earlier verification-publication-2026-10-03.json failed during concurrent test-first sync edits; it is retained as historical evidence, not final success.

Implementation, tests, and documentation remain uncommitted. No release or remote deployment occurred. Synthetic fixtures do not establish personal budget adoption. The next active task is synchronization.

Last Edited: 2026-10-03

Status: partial. Local creation, inspect/select, and clone are implemented. Publication, rename, and archive remain pending.

## Contract as-executed

Source: [plan.md](plan.md). `budgets create --name <name> [--currency <code>]` requires offline mode and returns the stable local budget ID. It preserves default categories, saves currency through the existing synced preference writer, and never publishes. Creation does not change a saved profile. Reads and finance calculations retain existing authority.

The public API exposes `createBudget({ name, currency })`. Its engine handler validates before closing the selected budget, invokes `create-budget` with upload disabled, and loads the result. The CLI creates a missing data directory and serializes creation using a device-local lock.

## Execution decision audit

See [execution-decisions.md](execution-decisions.md). Reusing import mode would clear categories and could publish. The new API delegates to the existing creation owner instead. Cleanup now occurs at the budgetfile owner after failed initialization.

## Authority and change map

- `packages/api/methods.ts` and core handler types expose the supported creation contract.
- `packages/loot-core/src/server/api.ts` owns validation and preference initialization.
- `packages/loot-core/src/server/budgetfiles/app.ts` owns file creation and cleanup.
- `packages/cli/src/commands/budgets.ts` owns explicit mode, lock, and structured outcomes.
- CLI discovery/output, API tests, packaged lifecycle tests, docs, and release notes cover the interface.

Source state remains the engine budget and preferences. The creation lock is device-local derived state. No database migration or second ledger store was introduced.

## Acceptance / evidence

| Check | Status                                 | Evidence                                                                                                                                                                                        | Gap                                                                                                     |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A1    | Verified for local creation on Windows | Packaged CLI creates a budget in an empty directory, reopens it in another process, and creates an account. Currency survives reload.                                                           | Linux and browser interoperability remain unverified.                                                   |
| A2    | Verified on Windows                    | Packaged CLI clones an encrypted cached budget, edits the copy, and proves the local original and a new remote cache retain their accounts. Copies have no cloud, sync, or encryption identity. | Linux and browser interoperability remain unverified.                                                   |
| A3    | Partially verified                     | API fault injection proves cleanup after failed database copy. Validation preserves the selected budget. CLI rejects duplicate names and configured remote budgets remain unchanged.            | Publication, encryption metadata after publication, and cleanup failure outcomes require further tests. |

## Verification record

Local creation integration passed before the final combined check. API tests passed with 32 cases. Final workflow verification passed all eight checks: 32 API tests, 205 CLI tests, root type checking, uncached CLI/API/core build, server build, six packaged integration tests, targeted lint, and targeted formatting.

An early parallel API/integration run failed because the API test config removes its build output. These checks must run sequentially, followed by an uncached rebuild. Type checking also caught an invalid error-wrapper argument; it was corrected. Neither failure was classified as a repository baseline.

The installed chevrotain/cosmiconfig source-map warnings remain. Broad formatting has an untouched CLI tsconfig baseline; changed-file formatting is used. No personal budgets or files were used.

## Change control record

This slice follows the first complete operation checkpoint. Creation validation runs before writes. Failed creation removes only its generated directory. Filesystem cleanup can itself fail; such failures must be inspected before retrying. Financial calculations, allocation semantics, and import logic are unchanged.

The managed runtime and this creation slice are uncommitted. Earlier committed checkpoints are `68ffdbe3b` and `74cc213b3`. Generated output is excluded from commits.

## Continue from here

- Stop state: creation, inspect/select, and clone checkpoint; full task remains active.
- Next: explicit publication and rename/archive semantics. Archive must not delete a remote budget silently. Encrypted first publication must avoid uploading an unencrypted snapshot first.
- Verification: use this task's verify.json; API tests, type checking, rebuilds, then packaged tests must remain sequential.
- User input needed: none for synthetic implementation. Personal adoption remains a later task.

## 2026-10-03 inspection, selection, and clone checkpoint

Delivered `budgets inspect`, `budgets select <id> --save-profile <name>`, and `budgets clone --name <name>`. New commands default to version 2 JSON. Inspection is declared read-only. Selection validates the local budget before saving an offline profile in the existing store. Cloning requires offline initialization, closes the source SQLite connection before duplication, and delegates to the canonical budgetfile owner. Its source uses a shared budget lock; a separate lifecycle lock serializes new directory creation. The copy receives a new local ID and CRDT clock. It has no source cloud, sync, or encryption identity. Neither creation nor cloning changes a saved profile.

The public API exposes `inspectBudget()` and `cloneBudget({ name })`. The owner now resets the clone clock, rejects loader failures instead of returning an error as an ID, and reports incomplete cleanup. Decisions D4-D6 explain canonical duplication, owner hardening, and saved selection. Independent review remains pending.

All eight checks passed in the final sequential run. [Captured verification](verification-2026-10-03.json) retains commands, exit codes, timing, and output: 34 API tests, 206 CLI tests, root type checking, uncached CLI/API/core builds, server build, seven packaged integration tests, targeted lint, and targeted formatting. The clone API test first failed because inspection was unavailable, then passed after implementation. It verifies balances, currency, a different clock node, and unchanged source account names. Database-copy fault injection proves cleanup. The encrypted packaged scenario verifies saved selection after a process restart, absent remote identity on the copy, unchanged local source accounts, unchanged accounts in a new remote cache, and unchanged server budget inventory.

An initial packaged run failed because root type checking overwrote the server bundle with TypeScript output. Rebuilding the server resolved the failure. Type checking also caught an inferred options type and an unsupported Object.hasOwn call; both were corrected. These were implementation/setup failures, not repository baselines. The final verifier rebuilds both packages after type checking.

This is a passing intermediate checkpoint, not full lifecycle or CLI completion. Publication, rename, archive, Linux, browser interoperability, and personal validation remain. Work remains uncommitted. Continue with explicit publication, then rename/archive. First publication with encryption must avoid an unencrypted initial upload: current key-make resets an already published file, while initial upload stores the encrypted payload separately from key salt/test registration. Inspect `server/encryption/app.ts`, `server/cloud-storage.ts`, and sync-server `app-sync.ts` before implementing that boundary. Publication failures must expose uncertain outcomes without blindly repeating creation.
