Last Edited: 2026-10-03

# Plan: Preview, apply, receipts, and safe retry protocol

Roadmap stage: Foundation. Execution mode: AFK.
Prerequisites: [0007-cli-contract](../0007-cli-contract/progress.md), [0008-cli-integration-harness](../0008-cli-integration-harness/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md), [0013-cli-backups](../0013-cli-backups/progress.md)

## 1. Current state

Writes are serialized per CLI cache, but API mutation wrappers intentionally disable UI undo. There is no durable CLI preview/apply journal.

Canonical owner files/directories inspected for this roadmap:

- `packages/cli/src/connection.ts`
- `packages/cli/src/lock.ts`
- `packages/cli/src/commands/transactions.ts`
- `packages/loot-core/src/server/api.ts`
- `packages/loot-core/src/server/mutators.ts`
- `packages/loot-core/src/server/undo.ts`

Current direction is CLI -> public API -> core engine; sync-server owns remote storage/authentication. Paths added below are proposed, not existing capabilities.

## 2. Target shape

Deliver: changes preview/apply/status/list; operation IDs; affected-record preconditions; durable receipts.

Extend the listed owners and add domain command/test modules under `packages/cli/src/commands/` as needed. Add strict shared types and supported public methods in `packages/api/methods.ts` and core handler types when a capability is missing. Extract client-owned business rules into core rather than importing React/client code into the CLI. Keep parser, transfer, reconciliation, and calculation authority in core; transport/lifecycle belongs to its existing server or CLI owner.

Existing commands retain legacy behavior. New operations use the versioned registry, result/error contract, session metadata, and capability declarations defined by cli-contract. Existing feature flags remain authoritative. Do not expose internal `api.internal` as a public tool contract.

## 3. Contract

### Observable behavior

- Typed domain operations share a preview/apply protocol with exact budget ID, operation ID, affected records, before/after values, and declared side effects.
- Apply refreshes and checks affected-record fingerprints inside the engine mutation boundary; stale observed state fails. Local locks are not advertised as cross-device transactions.
- Receipts distinguish prepared, committed-local, synced, failed-before-commit, and uncertain states; repeated IDs do not blindly replay uncertain writes.

### Preserved invariants

- Preserve signed ledger amounts, split/transfer integrity, and Actual's core calculation authority.
- Reads/previews must not mutate the ledger, allocations, templates, or schedules. Operational cache sync and explicitly disclosed device-local run records are separate from budget mutations.
- Keep cashPlanning targets separate from actual allocations. Preserve refunds, uncategorized amounts, and unavailable-category totals.
- Use strict TypeScript, public API boundaries, existing engine handlers, and root Yarn invocations. Never edit build artifacts or use real personal budgets for automated verification.

### Domain language

Use Actual's account, category, payee, cleared, reconciled, schedule, allocation, and synced preference terms. Operation receipt, preview token, statement coverage, and workflow run are new inferred tool concepts; their schemas belong to their prerequisite task, not new ledger semantics. A CLI cache lock is device-local; it is not a distributed lock.

### Non-goals

No exactly-once guarantee across independent CLI installations, global browser locks, universal undo, or claim that arbitrary API batches are atomic.

### Acceptance checks

| ID  | Required outcome                                                                                                                                                                      | Evidence                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A1  | A browser edit between preview and apply rejects the stale proposal after refresh; a different budget can never apply the token.                                                      | Focused integration fixture and captured JSON/CLI result |
| A2  | Killed processes before commit, after local commit, and before sync produce recoverable receipts or an explicit uncertain state, without automatic duplicate writes.                  | Focused integration fixture and captured JSON/CLI result |
| A3  | One existing transaction update and one allocation change pass through the protocol; preview produces no ledger/allocation/template writes and local journal retention is documented. | Focused integration fixture and captured JSON/CLI result |

### Checkpoint and change control

One complete operation path is the first slice. Stop at its acceptance checkpoint before extending related operations. Keep unrelated refactors separate. Resume from the last passing fixture and operation receipt. On a failed disposable test, restore or recreate its fixture; never revert the user's unrelated changes.

## 4. Data / API shape

Register explicit domain operation names and typed inputs/outputs for: changes preview/apply/status/list; operation IDs; affected-record preconditions; durable receipts.

Use stable budget/entity IDs, date-only strings, integer cents, and explicit currency/scale. Version 2 results include `schemaVersion`, `operation`, `context`, `data`, and `warnings`; errors include stable `code`, `message`, field-level details, and retryability. Context carries budget identity, local/remote mode, observed sync freshness, and applicable date/range. Lists expose paging/truncation. The registry declares preview/receipt support unavailable until cli-mutations passes. Earlier foundation slices use supported existing engine methods and their own explicit lifecycle/artifact outcomes in disposable tests. cli-mutations retrofits version 2 lifecycle writes with operation IDs/preconditions/receipts before general agent adoption. Do not claim an unavailable guarantee or invent a competing receipt format.

Review this task after its prerequisites complete; adopt their exact public types and schemas before implementation. Do not rebuild a prerequisite inside this task.

## 5. Runtime / lifecycle and diagnostics

Validate inputs and capabilities before side effects. Select an explicit budget/session; refresh when required and disclose offline/pending state. Acquire existing session locks and release engine/files/processes on success, failure, and cancellation. Return stale-preview or partial/uncertain outcomes rather than treating them as success. Retry reads/sync when supported; do not replay an uncertain mutation. Console diagnostics use stderr and redact secrets. Document unknown history and external-authentication limitations beside affected results.

## 6. Dependencies and constraints

[0007-cli-contract](../0007-cli-contract/progress.md), [0008-cli-integration-harness](../0008-cli-integration-harness/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md), [0013-cli-backups](../0013-cli-backups/progress.md)

Folder order is a recommended delivery order; the roadmap manifest defines the actual acyclic dependency graph. Optional MCP is never a prerequisite for the CLI. Shared-file edits (`methods.ts`, handler types, registry, manifests) must be integrated sequentially even for otherwise independent tasks. No new production dependency is assumed except the optional MCP task's SDK. Use installed Node/Yarn versions supported by repository manifests; validate Windows and Linux package execution.

## 7. Authority and state ownership

- Authority owner: Core API withMutation/runMutator owns precondition validation and budget mutation. The CLI operation executor owns durable local receipts and outcome reconciliation.
- Decision point: validate IDs/options and affected-record preconditions at the existing engine mutation boundary; parser/forecast/report decisions stay at their named core calculation boundary.
- Source state: Actual ledger, rules, schedules, account metadata, budget allocations, and typed preferences through public API. User files/statements are external input, never assumed verified bank truth.
- Working state: transient parsed rows, scenario overrides, proposed changes, and in-flight workflow steps.
- Derived/cache state: budget cache, query pages, summary figures, candidate matches, fingerprints, and observed freshness.
- Persisted state: engine-owned budget records/preferences; separately device-local profiles, receipt/run journals, mapping provenance, and backup manifests. Never store credentials in receipts or raw personal records in repository fixtures.
- Writers/readers: CLI/API/core changes use existing mutator/sync pathways; browser reads the same state. API/schema extraction must not create a core dependency on CLI or React.

## 8. Proposed approach

Execution mode: AFK. Three independently verifiable slices:

1. Add typed changes protocol and device-local journal with bounded retention; preview/apply an existing transaction update as the first slice.
2. Expose engine precondition checks and mutation outcome capture through supported API handlers; add local commit identity evidence rather than assuming UI undo or distributed atomicity.
3. Add operation-status recovery after restart and post-commit sync failure; retrofit version 2 budget create/publish/rename/archive and restore/clone writes plus existing mutation adapters before dependent tools, without breaking legacy writes.

After each step, run its focused unit/integration proof for the corresponding acceptance check and capture results in `implementation.md`. Before a dependent task starts, close all three checks or explicitly revise the dependency contract and record the decision.

Avoid one universal execute operation, duplicate finance formulas, and a second tool-only persistence path for budget state. Registry, session, receipts, and workflow adapters are shared infrastructure; domain-specific behavior remains explicit.

### Implementation addendum from owner review (2026-10-03)

Use one core mutation wrapper for each guarded domain implementation. Do not call another withMutation wrapper from inside runMutator. Reuse the existing transaction and allocation implementation owners; do not duplicate split, transfer, or budget calculations. Preview identifies the canonical affected closure, relevant references/configuration, before/after values, and declared side effects. Apply validates the exact selected local/remote identity and observed preconditions inside that same serialized engine call after online refresh. The local lock cannot exclude later remote CRDT edits.

The device-local journal persists a prepared proposal before returning its token. It atomically persists uncertain apply intent before issuing the engine mutation. It records committed-local only from an acknowledged successful engine outcome, then synced only after successful synchronization. Process death or an unacknowledged response leaves uncertain; matching after-values cannot establish causation. Repeated IDs with mismatched input reject; committed or uncertain IDs never automatically re-execute. Status may reconcile supported engine evidence, but missing proof remains uncertain. A new engine persistence mechanism is not assumed necessary: explicit uncertainty is an allowed acceptance outcome.

Integrate journal phase handling with the existing connection owner. Persist local outcome before its automatic sync and sync outcome afterward. Hold the existing session lock through shutdown. Reject --no-lock for protected version 2 operations. Offline apply discloses unknown remote freshness and enforces local observed preconditions. Preview may refresh cache and write its disclosed device-local proposal, but cannot mutate ledger, allocation, template, or schedule state.

Journal retention is bounded and documented. Preserve unresolved prepared/uncertain entries; fail before a new mutation when unresolved entries prevent safe bounded retention. Use private files, schema versions, path boundaries, atomic publication, and bounded list/status output. Journal records contain no credentials. Record sensitive before/after values only as required by the operation and document their local storage.

First verify transaction preview/apply and engine guards together. Then add allocation and retrofit version 2 lifecycle and existing mutation adapters. Keep all original acceptance checks. Kill tests wait for a specific phase checkpoint before termination and inspect independent ledger and durable receipt state after restart. Do not substitute a timing sleep for proof of the killed phase.

## 9. Migration and compatibility

Preserve existing IDs, CLI names/default legacy JSON, preference keys, parser mappings, and sync identities unless the operation explicitly creates a clone/new budget. Persisted tool schemas are versioned; do not silently reinterpret old receipts or jobs. If extraction moves UI business logic, maintain parity tests before switching consumers. Any necessary core data migration must be explicit, engine-owned, tested, and recorded during task review; no speculative migration is authorized by this plan.

## 10. Impacted surfaces

CLI commands/registry, public API/types, relevant core handlers, docs, and focused integration tests. Browser changes occur only when sharing an existing business owner or proving interoperability. Server changes occur only in runtime/authentication/sync-owning tasks. Build/package artifacts are generated by checks and never edited manually.

## 11. Edge cases and failure modes

Primary risk: Crash ambiguity and concurrent CRDT edits; globally atomic compare-and-swap is not available.

Test unknown/ambiguous IDs, wrong budget, deleted/hidden references, malformed input, cancellation, encrypted sessions, stale cache/proposal, and partial commit/sync at the affected boundaries. Reconciled and linked-transfer records require their domain invariants. Degrade to explicit unavailable/unknown/uncertain output; never fabricate verified zeros or blanket atomicity.

## 12. Verification plan

Map A1-A3 to the section 3 evidence table and record exact fixture, command, outcome, and limitation in `implementation.md`. No feature verification has run for this new task.

- From repository root: `yarn workspace @actual-app/cli test` and `yarn workspace @actual-app/api test` when changed; narrow core/server Vitest suites to the affected owners.
- Run `yarn typecheck`, targeted `yarn exec oxlint <changed-source-paths>` and `yarn exec oxfmt --check <changed-paths>`, and `yarn build:cli`. Run API/server/browser package builds and desktop/mobile Playwright checks when those surfaces change.
- Use the disposable child-process/server harness, restart/fault-injection cases, and two-client/browser checks applicable to A1-A3. Do not substitute mocked fixtures for claimed remote convergence.
- Add task `verify.json` during implementation with focused commands; do not let generic verification accidentally launch the entire monorepo test suite.
- Record unrelated repository-wide baseline failures separately. Existing cash-planning records describe formatting failures and unverified personal exports; remeasure rather than declaring them fixed.
- Personal adoption is HITL: representative files/account facts are not currently available and are not needed for synthetic tool implementation.

## 13. Documentation notes

Update `packages/docs/docs/api/cli.md`, `packages/cli/README.md`, and relevant API/domain docs plus a release note when implementation changes public behavior. Maintain `.workflow/cli-roadmap.md` and `.workflow/cli-roadmap.json` when dependencies or scope change. Store private adoption evidence outside git.

## 14. Open questions / missing info

No user decision blocks writing or reviewing this task. Exact prerequisite-produced symbols and schemas must be reread at task review; this is a dependency checkpoint, not a request for repeated user approval.

Planning verdict: reviewed; proceed after the owner-review addendum above. Prerequisites are complete locally on Windows. Implementation has not started.
