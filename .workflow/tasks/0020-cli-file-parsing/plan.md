Last Edited: 2026-10-02

# Plan: File inspection, parsing, and shared import mappings

Roadmap stage: Domain tools. Execution mode: AFK.
Prerequisites: [0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0017-cli-query](../0017-cli-query/progress.md)

## 1. Current state

Core transactions-parse-file and UI mapping helpers support formats; saved CSV mappings are synced preferences. CLI transaction files are JSON only.

Canonical owner files/directories inspected for this roadmap:

- `packages/loot-core/src/server/transactions/import/parse-file.ts`
- `packages/loot-core/src/server/transactions/app.ts`
- `packages/desktop-client/src/components/modals/ImportTransactionsModal`
- `packages/loot-core/src/types/prefs.ts`

Current direction is CLI -> public API -> core engine; sync-server owns remote storage/authentication. Paths added below are proposed, not existing capabilities.

## 2. Target shape

Deliver: imports inspect/parse; mappings list/get/set/reset; account/date/amount/encoding choices.

Extend the listed owners and add domain command/test modules under `packages/cli/src/commands/` as needed. Add strict shared types and supported public methods in `packages/api/methods.ts` and core handler types when a capability is missing. Extract client-owned business rules into core rather than importing React/client code into the CLI. Keep parser, transfer, reconciliation, and calculation authority in core; transport/lifecycle belongs to its existing server or CLI owner.

Existing commands retain legacy behavior. New operations use the versioned registry, result/error contract, session metadata, and capability declarations defined by cli-contract. Existing feature flags remain authoritative. Do not expose internal `api.internal` as a public tool contract.

## 3. Contract

### Observable behavior

- CSV/OFX/QFX and other parser-supported formats return format, date range, row validation, hash, and normalized transaction candidates without importing.
- CLI and UI share field/date/sign/encoding normalization and account-scoped saved mappings.
- Ambiguous dates, currency mismatch, malformed amounts, and missing required mappings produce row-level errors; files are not executed.

### Preserved invariants

- Preserve signed ledger amounts, split/transfer integrity, and Actual's core calculation authority.
- Reads/previews must not mutate the ledger, allocations, templates, or schedules. Operational cache sync and explicitly disclosed device-local run records are separate from budget mutations.
- Keep cashPlanning targets separate from actual allocations. Preserve refunds, uncategorized amounts, and unavailable-category totals.
- Use strict TypeScript, public API boundaries, existing engine handlers, and root Yarn invocations. Never edit build artifacts or use real personal budgets for automated verification.

### Domain language

Use Actual's account, category, payee, cleared, reconciled, schedule, allocation, and synced preference terms. Operation receipt, preview token, statement coverage, and workflow run are new inferred tool concepts; their schemas belong to their prerequisite task, not new ledger semantics. A CLI cache lock is device-local; it is not a distributed lock.

### Non-goals

No new bank-specific parser without representative evidence; no PDF/OCR statement ingestion in this task.

### Acceptance checks

| ID  | Required outcome                                                                                                           | Evidence                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A1  | CSV debit/credit columns, negative card amounts, locale/date formats, encoding, and OFX/QFX IDs match UI parsing fixtures. | Focused integration fixture and captured JSON/CLI result |
| A2  | A saved CLI mapping is usable in the browser and vice versa; inspect/parse performs no ledger writes.                      | Focused integration fixture and captured JSON/CLI result |
| A3  | Malformed/oversized/ambiguous input is rejected or explicitly partial; source hash changes invalidate a prepared import.   | Focused integration fixture and captured JSON/CLI result |

### Checkpoint and change control

One complete operation path is the first slice. Stop at its acceptance checkpoint before extending related operations. Keep unrelated refactors separate. Resume from the last passing fixture and operation receipt. On a failed disposable test, restore or recreate its fixture; never revert the user's unrelated changes.

## 4. Data / API shape

Register explicit domain operation names and typed inputs/outputs for: imports inspect/parse; mappings list/get/set/reset; account/date/amount/encoding choices.

Use stable budget/entity IDs, date-only strings, integer cents, and explicit currency/scale. Version 2 results include `schemaVersion`, `operation`, `context`, `data`, and `warnings`; errors include stable `code`, `message`, field-level details, and retryability. Context carries budget identity, local/remote mode, observed sync freshness, and applicable date/range. Lists expose paging/truncation. Mutations use prerequisite-owned operation IDs, before/after values, affected-record preconditions, side effects, and commit/sync status. Do not invent per-domain receipt formats.

Review this task after its prerequisites complete; adopt their exact public types and schemas before implementation. Do not rebuild a prerequisite inside this task.

## 5. Runtime / lifecycle and diagnostics

Validate inputs and capabilities before side effects. Select an explicit budget/session; refresh when required and disclose offline/pending state. Acquire existing session locks and release engine/files/processes on success, failure, and cancellation. Return stale-preview or partial/uncertain outcomes rather than treating them as success. Retry reads/sync when supported; do not replay an uncertain mutation. Console diagnostics use stderr and redact secrets. Document unknown history and external-authentication limitations beside affected results.

## 6. Dependencies and constraints

[0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0017-cli-query](../0017-cli-query/progress.md)

Folder order is a recommended delivery order; the roadmap manifest defines the actual acyclic dependency graph. Optional MCP is never a prerequisite for the CLI. Shared-file edits (`methods.ts`, handler types, registry, manifests) must be integrated sequentially even for otherwise independent tasks. No new production dependency is assumed except the optional MCP task's SDK. Use installed Node/Yarn versions supported by repository manifests; validate Windows and Linux package execution.

## 7. Authority and state ownership

- Authority owner: Core transactions/import/parse-file.ts and the extracted shared normalization functions own parsing; existing synced preferences own mappings.
- Decision point: validate IDs/options and affected-record preconditions at the existing engine mutation boundary; parser/forecast/report decisions stay at their named core calculation boundary.
- Source state: Actual ledger, rules, schedules, account metadata, budget allocations, and typed preferences through public API. User files/statements are external input, never assumed verified bank truth.
- Working state: transient parsed rows, scenario overrides, proposed changes, and in-flight workflow steps.
- Derived/cache state: budget cache, query pages, summary figures, candidate matches, fingerprints, and observed freshness.
- Persisted state: engine-owned budget records/preferences; separately device-local profiles, receipt/run journals, mapping provenance, and backup manifests. Never store credentials in receipts or raw personal records in repository fixtures.
- Writers/readers: CLI/API/core changes use existing mutator/sync pathways; browser reads the same state. API/schema extraction must not create a core dependency on CLI or React.

## 8. Proposed approach

Execution mode: AFK. Three independently verifiable slices:

1. Extract UI-only normalization/mapping authority into shared/core code with parity fixtures; keep UI behavior unchanged.
2. Expose supported parser methods via API and add inspect/parse against selected account without mutation.
3. Add typed mapping tools through existing prefs with receipts; document supported formats without claiming institution-export compatibility.

After each step, run its focused unit/integration proof for the corresponding acceptance check and capture results in `implementation.md`. Before a dependent task starts, close all three checks or explicitly revise the dependency contract and record the decision.

Avoid one universal execute operation, duplicate finance formulas, and a second tool-only persistence path for budget state. Registry, session, receipts, and workflow adapters are shared infrastructure; domain-specific behavior remains explicit.

## 9. Migration and compatibility

Preserve existing IDs, CLI names/default legacy JSON, preference keys, parser mappings, and sync identities unless the operation explicitly creates a clone/new budget. Persisted tool schemas are versioned; do not silently reinterpret old receipts or jobs. If extraction moves UI business logic, maintain parity tests before switching consumers. Any necessary core data migration must be explicit, engine-owned, tested, and recorded during task review; no speculative migration is authorized by this plan.

## 10. Impacted surfaces

CLI commands/registry, public API/types, relevant core handlers, docs, and focused integration tests. Browser changes occur only when sharing an existing business owner or proving interoperability. Server changes occur only in runtime/authentication/sync-owning tasks. Build/package artifacts are generated by checks and never edited manually.

## 11. Edge cases and failure modes

Primary risk: Sign/date mistakes can corrupt an entire history.

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

Planning verdict: ready for review-plan. Implementation is not started, and prerequisite holds still apply.
