# Actual fork reconnaissance

**Research snapshot:** 2026-09-27

**Canonical upstream checked:** [`actualbudget/actual`](https://github.com/actualbudget/actual), `master`

**Scope:** Public forks enumerated from GitHub, commit-compared against upstream, then feature-focused inspection of forks with unique commits and useful file changes. The goal is to find work worth adapting into the `insominx/actual` fork, not to recommend wholesale merges.

## 0. TL;DR / Executive Summary

### Top 3 takeaways

1. **Budget reservations** in [`hubermjonathan/actual`](https://github.com/hubermjonathan/actual) are the strongest near-term feature candidate: they derive “reserved / allowance / spare” from existing goal templates and schedules at read time, with no new stored state. The fork is only 9 commits behind upstream (34 ahead); start by reviewing its domain tests and public API shape.
2. **Pay-period budgeting** in [`code-with-jov/actual-pay-periods`](https://github.com/code-with-jov/actual-pay-periods/tree/develop) is the most complete design/implementation package: weekly, biweekly, and monthly periods, settings, budget UI, mobile and end-to-end tests, plus documentation. It changes the meaning and addressing of budget periods broadly, so port incrementally and validate across all date-based consumers.
3. **Expense-only budget view and statement guidance** in [`ejina21/actualFinance`](https://github.com/ejina21/actualFinance) are recent (17 ahead / 2 behind) and come with detailed specs and tests. The expense calculation is a relatively separable candidate; the bank guidance is market-specific and deliberately reuses the existing import flow.

### Top 3 constraints

- The enumeration returned 3,063 unique fork entries while GitHub’s fork count reported 3,037 at the initial snapshot. All 3,063 entries were attempted in the comparison pass; 46 comparisons returned 404. Fork metadata and commit distance are broad coverage, but source-level review focused on feature-bearing candidates, not every file in every fork.
- Commit-distance counts are not a quality or maintenance score. A fork far behind upstream can still contain a useful isolated idea, but its branch is a poor cherry-pick base. Recheck against the then-current upstream before adopting anything.
- Data model, migrations, sync, locale, and account/budget semantics are the main integration hazards. Use the forks as implementation references, isolate a feature’s commit range, and port/test against our branch rather than merging whole branches.

## 1. Scope & assumptions

- Enumerated public forks of `actualbudget/actual`, newest-first, and compared each default branch with upstream `master` using GitHub’s compare API.
- Snapshot result: **3,063 unique entries**: 293 had commits ahead (292 diverged and 1 strictly ahead), 7 were identical, 2,717 were behind with no unique commits, and 46 comparisons returned 404/unavailable. The initial upstream fork-count field said 3,037; GitHub’s count and paginated listing did not agree during this scan.
- A further source/file-list pass covered the **133 repositories at least 5 commits ahead**. High-signal feature candidates were then inspected directly in README/spec/design/source/test files. Low-delta forks were screened by commit state and change summaries where available; this is not a claim that all 3,063 code trees were read file-by-file.
- “Ahead” means unique commits against the upstream comparison point at scan time. It does not establish that a patch is still needed, mergeable, safe, maintained, or compatible with this fork.
- No application code was changed. Findings are recommendations for future human/agent review.

## 2. Source Index

### Primary repository evidence

- [Upstream Actual repository](https://github.com/actualbudget/actual) — comparison baseline and current architecture reference.
- [GitHub forks list](https://github.com/actualbudget/actual/forks) — public fork discovery surface; listing and reported fork count were inconsistent during pagination.
- [Official community projects page](https://actualbudget.org/docs/community-repos/) — documents community-maintained integrations for bank importing, AI categorization, MCP, Wallos schedules, and other features that can be used outside the core fork. The page explicitly says these projects are not maintained by Actual and serve special use cases or features not yet integrated.

### High-signal fork source files

- [Reservations guide](https://github.com/hubermjonathan/actual/blob/master/packages/docs/docs/experimental/reservations.md), [calculation module](https://github.com/hubermjonathan/actual/blob/master/packages/loot-core/src/server/budget/reservations.ts), and [CLI command](https://github.com/hubermjonathan/actual/blob/master/packages/cli/src/commands/reservations.ts).
- [Pay-period guide](https://github.com/code-with-jov/actual-pay-periods/blob/develop/packages/docs/docs/experimental/pay-periods.md), [period math](https://github.com/code-with-jov/actual-pay-periods/blob/develop/packages/loot-core/src/shared/pay-periods.ts), [server config](https://github.com/code-with-jov/actual-pay-periods/blob/develop/packages/loot-core/src/server/budget/pay-period-config.ts), and [e2e tests](https://github.com/code-with-jov/actual-pay-periods/tree/develop/packages/desktop-client/e2e).
- [`ejina21` expense-view spec](https://github.com/ejina21/actualFinance/blob/master/docs/superpowers/specs/2026-09-25-expense-only-budget-view.md), [pure aggregation function](https://github.com/ejina21/actualFinance/blob/master/packages/desktop-client/src/components/budget/expense-view/expenseData.ts), [Russian bank statement spec](https://github.com/ejina21/actualFinance/blob/master/docs/superpowers/specs/2026-09-25-russian-bank-statement-import-design.md), and [tests](https://github.com/ejina21/actualFinance/tree/master/packages/desktop-client/src/components/budget/expense-view).
- [`lefevreste/budget-fr` layered-period ADR](https://github.com/lefevreste/budget-fr/blob/master/docs/budget-fr/adr/0006-layered-budget-period-assignment.md) and [sync convergence spikes](https://github.com/lefevreste/budget-fr/tree/master/docs/budget-fr/spikes).
- [`shawalli/actual` feature README](https://github.com/shawalli/actual/blob/fork/master/README.md) — documents transaction flags, resizable transaction columns, and gift-card split behavior.
- [`abloomston/actual` ZDR notes](https://github.com/abloomston/actual/blob/master/packages/categorization-plugins/OPENROUTER-ZDR.md) and [OpenRouter adapter](https://github.com/abloomston/actual/blob/master/packages/categorization-plugins/src/openrouter.ts).
- [`BryanStarbuck/actual_budget_bryan` README](https://github.com/BryanStarbuck/actual_budget_bryan/blob/master/README.md) and [MCP write gates](https://github.com/BryanStarbuck/actual_budget_bryan/blob/master/mcp/src/gates.ts).
- [`Founderealm` debt-tracking guide](https://github.com/Founderealm/actual_debt_features/blob/master/packages/docs/docs/experimental/debt-tracking.md).
- [`xpbach2508` gold-account design](https://github.com/xpbach2508/actual-budget/blob/master/docs/superpowers/specs/2026-07-25-gold-account-valuation-design.md) and [asset-allocation report](https://github.com/xpbach2508/actual-budget/blob/master/packages/desktop-client/src/components/reports/reports/AssetAllocation.tsx).
- [`SensorsIot` Swiss importer spec](https://github.com/SensorsIot/actual/blob/master/Documents/Actual-CSV-Importer-fsd.md), [reporting spec](https://github.com/SensorsIot/actual/blob/master/Documents/Actual-Reporting-fsd.md), and [custom-features guide](https://github.com/SensorsIot/actual/blob/master/Documents/Custom-Features.md).
- [`moxin178` Chinese payment-file import design](https://github.com/moxin178/actual/blob/master/docs/superpowers/specs/2026-07-18-chinese-payment-file-import-design.md).
- [`StephenBrown2/actual` Wallos importer files](https://github.com/StephenBrown2/actual/tree/main/packages/loot-core/src/server/importers).
- [`LukeL40/Financial-Advisor-` architecture](https://github.com/LukeL40/Financial-Advisor-/blob/master/docs/FINANCIAL_BRAIN_ARCHITECTURE.md) — a read-only financial-planning/recommendation domain layer.

## 3. Core Concepts & Architecture

### Priority candidates

| Priority | Fork and distance                                                                                                             | What it contributes                                                                                                                                           | Porting outlook                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**    | [`hubermjonathan/actual`](https://github.com/hubermjonathan/actual) — 34 ahead / 9 behind                                     | Category reservations derived from existing recurring schedule/goal-template data; balance breakdown in UI/mobile; API and CLI support; extensive tests/docs. | Most promising to review first. Calculation is read-time and appears not to add persisted state. Still inspect category math and due-date edge cases carefully.                                                     |
| **A**    | [`code-with-jov/actual-pay-periods`](https://github.com/code-with-jov/actual-pay-periods/tree/develop) — 47 ahead / 67 behind | Weekly, biweekly, and monthly budgeting periods anchored on a payday; settings, toggle, budget columns, mobile, goals/templates, reports, tests, docs.        | Strong complete reference. Broad and cross-cutting; prefer staged porting over cherry-picking the whole 116-file change set.                                                                                        |
| **A**    | [`ejina21/actualFinance`](https://github.com/ejina21/actualFinance) — 17 ahead / 2 behind                                     | Expense-only budget display, Russian bank statement help for local accounts, and family/sidebar themes. Specs, unit tests, and e2e coverage are present.      | Close to upstream. Review each feature separately; expense aggregation is the most contained piece. The whole fork is 220 changed files, much wider than these features.                                            |
| **B**    | [`lefevreste/budget-fr`](https://github.com/lefevreste/budget-fr) — 12 ahead / 69 behind                                      | Detailed exploration of assigning transactions to a budget period independent of bank date, and sync/CRDT convergence.                                        | Best as domain/CRDT design evidence, not a ready patch. ADR-0002 is explicitly superseded by ADR-0006; use the newer layered-assignment decision and convergence tests.                                             |
| **B**    | [`abloomston/actual`](https://github.com/abloomston/actual) — 6 ahead / 14 behind                                             | Pluggable transaction categorization (embeddings and LLM judge) with an OpenRouter transport that requests ZDR routing and tests.                             | Reuse architecture/tests if AI categorization is in scope. More appropriate as an optional plugin or external service than a mandatory core dependency.                                                             |
| **B**    | [`moxin178/actual`](https://github.com/moxin178/actual) — 43 ahead / 166 behind                                               | Chinese payment statement import, including GB18030 CSV decoding and XLSX normalization into Actual’s existing import preview/mapping flow.                   | Good localized importer pattern; the spec deliberately excludes `.xls`, formula recalculation, and automatic field semantics. Port only if target users need those formats.                                         |
| **B**    | [`shawalli/actual`](https://github.com/shawalli/actual/tree/fork/master) — 20 ahead / 993 behind                              | Transaction flags, resizable transaction columns, and a special gift-card split workflow; README describes mobile and bulk-edit/filter support for flags.     | Useful product ideas, but this branch is extremely stale. Transaction flags touch the synced transaction model; gift cards affect split semantics. Treat as design references and reimplement against current code. |
| **B**    | [`BryanStarbuck/actual_budget_bryan`](https://github.com/BryanStarbuck/actual_budget_bryan) — 13 ahead / 14 behind            | Dedicated local machine API shared by CLI and MCP, with explicit write gates and audit logging.                                                               | Security design worth studying if adding agent access. An official community MCP project is already listed, so compare external integration cost before adding a new API surface to core.                           |

### Additional useful or niche work

- **Debt accounts and payment breakdowns:** [`Founderealm/actual_debt_features`](https://github.com/Founderealm/actual_debt_features) (21 ahead / 1,130 behind) adds debt types, principal/interest/fee breakdowns, payoff/report UI, and two schema migrations. Its experimental docs say amortization schedules and payoff projections are not implemented. Useful feature reference; high sync/schema migration cost and a very stale base make whole-branch cherry-pick inappropriate.
- **Investment and gold tracking:** [`xpbach2508/actual-budget`](https://github.com/xpbach2508/actual-budget) (151 ahead / 70 behind) adds asset-allocation reporting and a detailed physical-gold lot/valuation workflow (currency/unit assumptions are VND and chỉ/cây). The design separates synced lots, true transfers, and off-budget revaluation adjustments. Strong reference for asset modeling, but explicitly niche, broad, and migration-heavy.
- **Swiss statement imports and reporting:** [`SensorsIot/actual`](https://github.com/SensorsIot/actual) (233 ahead / 918 behind) has bank-specific Revolut, Migros, and Kantonalbank import flows plus Budget-vs-Actual and Current Asset Value reports. Its importer spec extracts shared preview/category/note handling; the reporting spec notes Budget-vs-Actual only supports Tracking mode. Valuable regional pattern, but very stale and contains multiple large feature families.
- **Pay-cycle management:** [`leuwk/actual-budget`](https://github.com/leuwk/actual-budget) (11 ahead / 297 behind) has a dedicated pay-cycle page, core model, and migration. It overlaps with the broader pay-period work above and is less attractive as a base.
- **Schedule forecasting:** [`Icarus-A7/actual`](https://github.com/Icarus-A7/actual) (7 ahead / 762 behind) contains a schedule forecast widget and utilities. Review only if upstream still lacks the specific projection behavior wanted; branch is stale.
- **Forecast smoothing design:** [`MikeBishop/actual`](https://github.com/MikeBishop/actual) (7 ahead / 64 behind) contributes design/plan docs for smoothing schedule forecasts. Useful requirement discussion; this fork’s unique changed files are docs rather than a complete implementation.
- **Read-only financial recommendations:** [`LukeL40/Financial-Advisor-`](https://github.com/LukeL40/Financial-Advisor-) (19 ahead / 160 behind) explicitly proposes a read-only snapshot/policy/allocator layer. Its safety boundary (recommendations may not mutate ledger or external accounts) is a useful architecture constraint if this product direction is considered.
- **Wallos schedules:** [`StephenBrown2/actual`](https://github.com/StephenBrown2/actual) (5 ahead / 44 behind) adds Wallos subscription import. The official [community projects page](https://actualbudget.org/docs/community-repos/) already lists `actual-wallos-import`; use the external importer unless there is a clear benefit to maintaining this inside the fork.

### AI reports and forks not currently verifiable

- `luisbeqja/actual_ai_analysis` showed 3 unique commits / 2,695 behind in the comparison snapshot, with report/LLM-related paths in the earlier file summary. Direct file fetches now return GitHub 404, so this is not verified enough to recommend. Recheck repository visibility and branch before using.
- `goccert25/actual` (32 ahead / 579 behind) includes an `actual-ai/` service; the official community page also lists an external Actual AI categorization tool. Prefer an external integration unless embedded AI is an explicit product requirement.

### Broad low-signal / stale results

- Many forks with unique commits are mostly theme, translation, generated UI snapshots, old API code, personal infrastructure, or old upstream history rather than reusable features.
- Examples where the repository description alone is misleading or insufficient: branch names such as `periods`, `forecast-master`, and fork README feature lists can refer to stale code. Inspect current changed paths and commit ancestry rather than trusting description text.
- Chinese translation-only trees are lower priority because localization is maintained through the project’s current i18n workflow; prefer upstream translation tooling and selectively reuse importer behavior.

## 4. Integration Patterns & Examples

### Reservations: derive claims from existing data

The reservations implementation calculates values on read from schedules and goal templates rather than storing a new “reserved amount.” Its documented breakdown is **reserved** (future obligations), **allowance** (intended current-period spending), and **spare** (unclaimed remainder). This avoids a new persisted value that could go stale after transactions or budget edits. The example code path to study is `server/budget/reservations.ts` → category balance display/mobile menu → API/CLI; check date rollover, paid-this-month behavior, overspending, negative spare, and prior-month reads.

### Pay periods: preserve the bank date, change the budget-period mapping

`actual-pay-periods` anchors weekly/biweekly/monthly ranges to a configured payday and maps periods into Actual’s budget-month identifier space. The fork’s shared module validates schedule configuration and computes ranges; server config listens to synced preferences and rebuilds budgets when they change. Cross-check every month-key consumer (reports, templates, schedules, goals, category drilldowns, mobile navigation, and year boundaries). The separate Budget FR ADR is a useful warning: a transaction’s bank date and the month to which it is budgeted are different concepts, and independent synced columns can converge into torn tuples under concurrent edits.

### Expense-only view: pure aggregation, separate display state

`ejina21` keeps the existing envelope/tracking calculation mode intact and adds a read-only display mode. Its pure `buildExpenseSummary` converts transactions into day/month columns, filters transfers/income/off-budget categories, and makes refunds reduce expense. A port should avoid hard-coding Russian category-group names into shared logic; pass exclusions as locale/account settings or derive them from stable identifiers. Keep privacy mode, zero-activity periods, uncategorized expenses, and narrow screens covered.

### Statement guidance: add account metadata, reuse the importer

The Russian bank spec stores an optional manual bank identifier in synced per-account preferences, not `AccountEntity.bank` (which represents a linked bank-sync relationship). It routes help to existing CSV/TSV/QIF/OFX/QFX/CAMT import and preview. It explicitly does not claim PDF is importable and acknowledges the current import-preview mobile limitation. The Chinese payment importer uses the same reuse-first principle: normalize provider file types into existing import rows/preview and avoid a second transaction creation pipeline.

### AI/agent integrations: optional plugin and explicit trust boundaries

The categorization plugin isolates transport and model behavior. Its OpenRouter adapter sends the `provider.zdr: true` policy, and its docs caution that ZDR availability is provider/model-specific and changes. Fail closed when no compliant endpoint exists; do not silently route elsewhere. For MCP or CLI writes, Bryan Starbuck’s design separates read-only and write modes and requires independent confirmation switches, while remaining local/loopback bound per its README. Compare with the listed external `actual-budget-mcp` first.

## 5. Alternatives & Trade-offs

| Need                                        | Best fork evidence                                                               | Alternative                                                                 | Trade-off                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| See money already committed to future bills | `hubermjonathan` reservations                                                    | Keep current category balance and rely on goal templates/schedules manually | Reservations improve spendable balance clarity, but derived math must match template/schedule semantics exactly.                            |
| Budget each paycheck                        | `code-with-jov` pay periods; `lefevreste` period-assignment ADR                  | Calendar-month budget, or external spreadsheet                              | Period columns fit cashflow cadence; wide UI/report/date/sync surface. Assignment override adds CRDT and transaction semantics.             |
| Spend-only view                             | `ejina21` expense view                                                           | Custom report/export                                                        | Integrated daily view is convenient; display-mode logic must not become a new budget engine.                                                |
| Regional import                             | `ejina21` manual bank help, `moxin178` Alipay/WeChat, `SensorsIot` Swiss parsers | External converters/importers from official community list                  | Core UX is seamless, but each provider format creates maintenance/testing burden. External tools keep country-specific parsing out of core. |
| AI transaction categorization               | `abloomston` plugin / official community Actual AI                               | Human review or external categorization service                             | Plugin boundaries and ZDR can reduce integration risk; external services still transmit financial data and require disclosure/consent.      |
| AI/MCP access                               | Bryan Starbuck fork                                                              | Officially listed external MCP integrations                                 | Core machine API enables deep coverage, but increases attack surface and compatibility obligations. External adapter is easier to isolate.  |
| Debt and investment models                  | `Founderealm`, `xpbach2508`                                                      | Track as ordinary off-budget accounts and use external reports              | Richer domain data enables detailed analytics but needs schema/sync correctness and careful accounting semantics.                           |

## 6. Constraints, Risks & Gotchas

- **Rebase distance:** The high-value small-delta forks are `hubermjonathan` (9 behind), `ejina21` (2), `abloomston` (14), and `BryanStarbuck` (14). Far-behind branches (`shawalli`, `SensorsIot`, `Founderealm`, `Icarus-A7`) should be mined for concepts or isolated commits, not merged.
- **Sync and migration:** Debt fields, gold-lot tables, manual transaction budget-period assignments, and transaction flags require reviewing local DB migrations, server/client sync, conflict behavior, imports/exports, and old-client compatibility.
- **Accounting correctness:** Reservation balance math, refunds, transfers, interest/principal/fees, gift-card splits, gold purchase/revaluation adjustments, and budget-vs-actual sign conventions can create misleading reports if ported without domain tests.
- **Experimental state:** Pay periods and reservations are documented as experimental in their forks. Treat edge cases, API contracts, data migration, and UX as provisional until tested on representative budgets.
- **Localization and identity:** Avoid using translated category labels as business keys; local bank identifiers and excluded category groups should be explicit/configurable.
- **AI privacy:** ZDR endpoint catalogs and provider policies change. Recheck the provider’s current terms and endpoint availability before shipping; keys must be protected and ledger data transmission made clear to users.
- **Fork drift:** README claims and branch names can outlive their implementation. Verify target commit, file list, license, tests, and upstream overlap immediately before cherry-picking.
- **Licensing:** These are Actual forks; verify each repository’s current license and any added dependencies/assets before reuse. Do not infer licensing from README text alone.

## 7. Open Questions

- Which of reservations, pay-period budgeting, expense-only display, localized imports, debt tracking, and AI access is a product priority for `insominx/actual`? This determines whether to port any candidate.
- Are the `hubermjonathan` reservation API and its balance semantics compatible with this fork’s budget modes and current schedule/goal-template implementation? This blocks cherry-pick approval.
- Does `luisbeqja/actual_ai_analysis` still exist on another branch or was it removed? Until accessible, its report implementation remains unverified.
- For any selected fork, have its feature commits or equivalent behavior since been merged upstream after this snapshot? Recompare before implementation.

## 8. Recommended Next Steps

1. Re-run upstream comparisons for the A-priority forks at the time of implementation and compare their feature paths against `insominx/actual`.
2. If choosing one low-risk first slice, evaluate `hubermjonathan` reservations: run its pure/core tests, review category balance invariants, and port the calculation plus tests before UI/API/CLI.
3. If pay-period budgeting is selected, read `lefevreste` ADR-0006 and convergence tests first, then design a port plan covering period IDs, timezone/date math, synced preferences, all budget consumers, and rollback/disable behavior.
4. If localization/import is the priority, select a single target bank/provider and adapt `ejina21` or `moxin178` to the existing importer; keep provider parsers independently tested.
5. Before any cherry-pick, confirm license/dependency implications, upstream overlap, database/sync changes, and test coverage on our fork. Prefer selected commits or a fresh port over merging stale histories.
