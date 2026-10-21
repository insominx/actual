Last Edited: 2026-10-21

# Plan: Bring upstream actualbudget/actual changes into the fork

Execution mode: HITL for the product decisions (D1–D10 in `execution-decisions.md`). Agent-executable for waves 1–5.
Prerequisites: none. Builds on fork commits `7a8acf89f` and `8d738787a` (bug-fix rounds, 2026-10-21).

## 1. Current state

- Fork point with upstream: `09c47beb6` (2026-09-27).
- Pinned upstream head for this task: `80f7518c8` (2026-10-21). Commits after this pin are out of scope (see section 14).
- 126 upstream commits are missing from the fork, and none have been applied. The fork has about 267 commits since the fork point.
- A full trial merge (`git merge --no-commit upstream/master`) conflicts in 181 files: about 120 are VRT PNG snapshots and about 73 are source files.
- Each commit was trial cherry-picked on its own onto fork `master` at `8d738787a`. The per-commit results are in [`triage.md`](triage.md): type, fork overlap, pick result, and recommendation.

Remote: `upstream` → `https://github.com/actualbudget/actual.git` (already added locally).

## 2. Target shape

Apply the useful upstream commits as attributed cherry-picks, in dependency order, on a dedicated branch. Resolve conflicts so that fork fixes and fork-only features (CLI, guarded proposals, cash planning, forecast, reservations, Monte Carlo fixes) survive. Skip commits the fork already covers or that would undo fork fixes. Hold product-level changes until the owner decides.

## 3. Contract

### Observable behavior

- Security advisories in `42e9d79d4` and the related hardening commits are closed in the fork.
- The listed upstream data-correctness fixes behave as upstream intends, and the existing fork behavior they overlap is preserved.
- Spreadsheet and cache performance commits deliver their speedups without breaking the fork's nested cache-barrier and budget-type gating.

### Preserved invariants

- Keep the fork's `token_expiration` in seconds. `42e9d79d4` would put back upstream's `* 60` minutes.
- Keep the fork's currency-aware formula scaling unless D1 adopts upstream's amounts-in-formulas.
- Keep the fork's fixes that upstream fixed differently: Sankey category labels, `getNextDate` weekend handling in both directions, the Electron export bytes handler, the Windows `spawnYarn` build fix, and the partial category update.
- Keep the fork's `budgetReservations` experimental toggle and the CLI behavior.
- Don't take upstream lockfile hunks that downgrade packages (dompurify, smol-toml). Use `yarn up` or `yarn install` instead.
- Strict TypeScript, root-only yarn, no edits to build artifacts.

### Domain language

Wave = an ordered batch of cherry-picks with one verification gate. Pick result = clean / adapt / skip / decide, as recorded in `triage.md`.

### Non-goals

- A wholesale `git merge upstream/master`.
- Upstream docs, CI and release-infrastructure commits (listed under Skip in `triage.md`).
- Regenerating every VRT screenshot. Only snapshots tied to picked UI changes are regenerated, in docker.
- Pushing to origin or opening a PR, unless the owner asks.

### Acceptance checks

| ID  | Required outcome                                                                                                                                                                                 | Evidence                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| A1  | Wave 1 (security) applied. Every advisory in `42e9d79d4` is either fixed in the fork or recorded as already fixed. Session, SSRF, Electron and import-destination tests pass.                    | Cherry-pick log, focused sync-server, Electron and loot-core tests, `yarn typecheck` |
| A2  | Wave 2 (clean data-correctness picks) applied with upstream tests passing.                                                                                                                       | Focused package test runs                                                            |
| A3  | Wave 3 (adapted data-correctness picks) applied. Each conflict resolution keeps the fork side named in `triage.md`.                                                                              | Diff review notes in `implementation.md`, focused tests                              |
| A4  | Wave 4 (performance) applied in the order 137922fd6 → 148e5c233 → 0f000bf69 and 0728f1a30 → a771f8280. Cache-barrier and failing-cell tests still pass. Cold-load improvement measured or noted. | loot-core spreadsheet, sync and budget tests; timing note                            |
| A5  | Wave 5 (small UI and extras) applied. Only the affected VRTs are regenerated, in docker.                                                                                                         | Web test suite, scoped VRT run                                                       |
| A6  | Each decision D1–D10 is recorded, and the approved items are applied with the same gates.                                                                                                        | `execution-decisions.md` updated                                                     |
| A7  | Full gate is green after each wave: `yarn typecheck`, loot-core / web / sync-server / cli / api suites, lint and format on changed files.                                                        | Results recorded per wave in `implementation.md`                                     |

### Checkpoint and change control

- Stop after each wave and record results before starting the next.
- If a pick turns out to need more than the adaptation noted in `triage.md`, record a new decision instead of improvising.
- Never revert the user's unrelated changes.

## 4. Data / API shape

No new APIs are introduced by this task. Upstream commits bring:

- `getScheduleDates` (`89384e0b7`)
- a `runBankSync` reconciled result (`f36804f04`)
- `canAccessActiveFile` (`0c571bc47`)
- session logout and revocation endpoints (`42e9d79d4`)

Check the fork CLI's use of `runBankSync`, password login and session tokens after wave 1 and wave 3.

## 5. Runtime / lifecycle and diagnostics

Behavior changes to announce:

- After `42e9d79d4`, every password login creates a new session, and API `shutdown()` revokes the sessions it created.
- `38de5cadb` moves self-signed certificate trust to `tls.setDefaultCACertificates`.
- `7474a9429` blocks LAN SimpleFIN bridges unless `ACTUAL_SIMPLEFIN_ALLOWED_NETWORKS` is set.

## 6. Dependencies and constraints

Upstream ordering requirements:

- `a3330d2f5` needs `24deae74e`.
- `821caa264` needs `2dc69b3de`.
- `148e5c233` needs `137922fd6`.
- `a771f8280` needs `0728f1a30`.
- `7474a9429`, `6e68ee1de` and `e4ee6935d` need `42e9d79d4`.
- `cc368d10c` needs `a264f7403`.
- `fab0ab1b9` needs `01dadbcae` and `52ac1f91e`.
- `18cc7da0d` and `fdf7f1b8c` need `8e165c0eb`.
- `8d59f30cf` needs `cba8cbd3f` and `832f43da6`.
- `bde50c3be` needs `63180ceea`.

Native modules require rebuilding after dependency bumps (`yarn install`).

## 7. Authority and state ownership

- Authority owner: the repo owner decides D1–D10 and whether to push.
- Source state: upstream commits pinned at `80f7518c8`, plus fork `master`.
- Working state: the dedicated branch `upstream-sync-2026-10`, created from `master` at execution time.
- Persisted state: commits on that branch, each made with `git cherry-pick -x` so the upstream SHA is recorded. Adapted picks note the resolution in the commit body.

## 8. Proposed approach

1. Create branch `upstream-sync-2026-10` from `master` and confirm `upstream/master` is still at or past `80f7518c8`.
2. **Wave 1, security:**
   1. `42e9d79d4` (adapt 8 files per `triage.md`)
   2. `e4ee6935d`
   3. `38de5cadb`
   4. `0c571bc47`
   5. `7474a9429` (adapt)
   6. The dependabot bumps: `f68fd9a47`, `3cb34d249` and `987747f6f` as picks; `954ad61d3` and `358823017` through `yarn up`.
3. **Wave 2:** the clean data-correctness picks listed in `triage.md`, oldest first.
4. **Wave 3:** the adapted data-correctness picks, each resolved as noted.
5. **Wave 4:** the performance picks in the required order.
6. **Wave 5:** small UI fixes, currencies and extras.
7. **Decisions:** apply the items approved under D1–D10 as separate commits.

After each wave, run section 12 and record the outcome in `implementation.md` before continuing. Prefer one commit per upstream commit, with the `[AI]` prefix and the upstream subject. Group trivially related picks only when the cherry-pick log stays clear.

## 9. Migration and compatibility

No data migration is authorized. D1 (formula semantics) would change how existing user formulas evaluate. It needs an explicit migration or release note if adopted. Session changes invalidate the reuse of existing sessions on password login; existing session tokens stay valid.

## 10. Impacted surfaces

- `packages/sync-server`: accounts, app-account, ssrf, the GoCardless, Enable Banking and SimpleFIN apps, files service
- `packages/desktop-electron`
- `packages/loot-core`: accounts sync, rules, spreadsheet, sheet, budget, sqlite platform, cloud-storage, importers, api
- `packages/desktop-client`: modals, mobile, reports, hooks, settings
- `packages/api`
- `packages/cli`: only through package versions and behavior checks
- `yarn.lock`
- VRT snapshots

## 11. Edge cases and failure modes

- A cherry-pick that applies cleanly can still break the fork semantically, for example a type signature change with fork-only callers. Typecheck and tests after every wave are mandatory.
- Lockfile conflicts: never hand-merge. Run `yarn install` or `yarn up`.
- CRLF churn in this Windows checkout: format only changed files (see AGENTS.md).
- If upstream moves past the pin before execution, re-triage the new commits before including them.

## 12. Verification plan

Per wave, from the repo root:

- `yarn typecheck`
- `yarn workspace @actual-app/core run test`
- `yarn workspace @actual-app/web run test`
- `yarn workspace @actual-app/sync-server run test`
- `yarn workspace @actual-app/cli run test`
- `yarn workspace @actual-app/api run test`
- `git diff --name-only <wave-base>.. | xargs npx oxfmt --check`, plus targeted `npx oxlint --type-aware` on changed sources
- Electron e2e (`yarn e2e:desktop`) for the wave 1 Electron hardening, if feasible
- Scoped VRTs in docker (`yarn vrt:docker`, with the `running-vrts` skill) for wave 5 UI picks

Record the exact commands and outcomes in `implementation.md`. `verify.json` holds the focused default profile.

## 13. Documentation notes

- Add a release note in `upcoming-release-notes/` per the writing-release-notes skill. It should summarize the security closures and user-visible behavior changes (sessions, self-signed certs, SimpleFIN LAN allow-list).
- Update `.workflow/README.md` status when the task completes.

## 14. Open questions / missing info

- D1–D10 in `execution-decisions.md` need the owner's decisions. Waves 1–5 do not depend on them.
- Should commits after the `80f7518c8` pin be triaged and included when execution starts?
- Push and PR policy for the sync branch: local only by default.

Planning verdict: ready for review. Implementation not started.
