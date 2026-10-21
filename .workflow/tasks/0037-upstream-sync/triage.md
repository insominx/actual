# Upstream triage: actualbudget/actual since the fork point

- Fork point: `09c47beb6` (2026-09-27). Upstream head: `80f7518c8` (2026-10-21).
- 126 upstream commits are missing from the fork; none had been applied.
- A full trial merge conflicts in 181 files: about 120 are VRT PNGs, about 73 are source files.
- Every commit below was trial cherry-picked on its own onto fork `master` (`8d738787a`) in a throwaway worktree.

## Wave 1: security (apply first)

| sha                             | what                                                               | pick              | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 42e9d79d4                       | Squashed fixes for 13 GitHub security advisories                   | adapt (8 files)   | The fork is still exposed to most of them. **Sessions:** a password login reuses the old token, changing the password doesn't revoke sessions, change-password doesn't ask for the old password and has no rate limit, and there is no logout. **SSRF:** the IPv6 6to4/Teredo/NAT64 ranges are open. **Commerzbank:** the bank's payee parsing can be stalled by a crafted payee name (a ReDoS). **Logs:** secrets end up in log files. **CLI CSV output:** values starting with a byte-order mark escape the spreadsheet-formula guard. **Electron:** `openExternal` accepts any protocol, the app checks URLs by substring, and UNC paths can reach `showItemInFolder`. **Import:** importing a budget file can overwrite another local budget. Two advisories are already fixed in the fork. **Keep the fork's `token_expiration` in seconds** (upstream multiplies it by 60). |
| e4ee6935d                       | Electron e2e fix for the above                                     | after 42e9        | Needs a file that 42e9d79d4 creates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 38de5cadb                       | Disable the Electron NODE_OPTIONS fuse                             | clean             | Blocks code injection through `NODE_OPTIONS`. Test a server with a self-signed certificate afterwards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0c571bc47                       | Block bank sync for deleted budgets                                | clean, tests pass | Pluggy can still reach a deleted budget, and its secrets survive deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7474a9429                       | Limit SimpleFIN private-network access to configured ranges        | adapt, after 42e9 | Adds DNS pinning (undici). A LAN SimpleFIN bridge will need `ACTUAL_SIMPLEFIN_ALLOWED_NETWORKS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| f68fd9a47, 3cb34d249, 987747f6f | Dependabot bumps (body-parser/qs, follow-redirects, launch-editor) | clean             | yarn.lock only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 954ad61d3, 358823017            | Dependabot bumps (electron, axios, ip-address, handlebars, pbkdf2) | adapt             | Use `yarn up`, not the upstream lockfile hunks: those would downgrade dompurify and smol-toml.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Wave 2: data correctness (clean picks)

- **Bank sync:**
  - 24deae74e: don't fuzzy-match the children of an exact-matched split.
  - 2dc69b3de then 821caa264: duplicate Enable Banking transactions, then the HypoVereinsbank fix.
  - af7c06fcb: Enable Banking payee by payment direction.
  - 18e995513: GoCardless retry on an expired token.
- **Rules and learning:**
  - db42f652e: don't learn a rule that a "one of" rule already covers.
  - 952aa2a67: learn categories from mobile saves.
- **Imports and schedules:**
  - 7e683249a: QIF categories preserved.
  - c65884a27: CSV unchecked-match merge.
  - c58e6c5dc: schedule-template underfunding for long intervals.
  - df4dc0d6c: auto-post again on the same day.
  - e35036803: split payees after posting.
- **Transfers and reconciliation:**
  - 1c852e488: transfer category on/off budget (client batch action).
  - 167bae44f: crash when cancelling the reconciled-edit modal, plus the mobile unlock.
- **Mobile, reports and dashboard:**
  - 3234be04d: move categories between groups on mobile.
  - 046239693: live spending reports at month rollover.
  - 638c9bc34: batch dashboard layout updates.
- **Web backend:** ef0f0614a: freeze on save (`BEGIN IMMEDIATE`).

## Wave 3: data correctness (needs adaptation)

- **a3330d2f5** (after 24deae74e): prefer unlinked rows in fuzzy matches. Take upstream's comparator; it includes the fork's fix.
- **b490e3e76**: "payee/category is nothing" rules skipping transactions. Keep the fork's `dryRun` argument.
- **3ea257434**: amounts with a currency suffix (`'3.4 €'` currently imports as 34). Swap one regex in the fork's `looselyParseAmount`.
- **a264f7403**: rules refilling fields the user cleared. Merge it into the fork's try/catch.
- **cc368d10c** (needs a264f7403): mobile notes/account edit after a split rule.
- **253823d39**: invalid regex in SQL fails the whole query. Only the tests conflict. Consider adding the fork's `hasNestedRepeat` guard to the SQL REGEXP as well.
- **9b4e30425**: multi-tab leader handover. One hunk; tests pass.
- **61775be12**: take the renderer half only. The fork's Electron half is already fixed, and without the renderer half the fork has unhandled rejections.
- **d2dae07f5**: refresh the dashboard on sync. Keep both invalidations.
- **f36804f04**: `runBankSync` returns reconciled ids. Imports only; useful to the CLI.
- **1eeffe327**: clear message when GoCardless credentials are missing. Only the tests conflict.

## Wave 4: performance

- **cf34c0e3b** (clean): O(V+E) topological sort. Upstream measured cold load dropping from 134 s to 6 s, and it skips cycles instead of running out of memory.
- **137922fd6** (clean), then **148e5c233**, then **0f000bf69**: faster budget-cache reset, cache cleared before rebuild, reused statement.
  - Compatible with the fork's barrier-depth counter.
  - Don't take 148e5c233 without 137922fd6: without its barrier, a crash mid-rebuild could load a half-built cache as valid.
- **0728f1a30** (take upstream's hunk), then **a771f8280**: free prepared statements (mostly already in the fork) and read column names once.

## Wave 5: small UI fixes and extras

- **Clean picks:**
  - Mobile and editing: 5e39105f5 (mobile datepicker), a74830ff8 (off-screen dashboard widgets), 34597d703 (clear payee on mobile), c72ce699b, 231e43bbe, ec78d7c4d, b26aef9ba, 832f43da6.
  - Reports and themes: 2420942e8, 6da9f6ac7, eb28966d6, 7f74953a5, the three privacy alignment fixes (76fb680bc, c4ccbf953, ed785afa0), 64be9c389, c59c4979e.
  - Fixes and misc: 7cd04aaf0 (HTTPS key newline), 80f7518c8 (formula on a date rule), 2e68845ed, 967684afa, 6ee7900cf (prefsSlice part only).
- **Currencies:** TZS, BDT, ZAR, NOK (4cfa91467, 4aad1489d, 4ae0f078e, 8c2fa0e86). Also 08b0deaf6, which changes the CHF symbol that existing users see.
- **Needs adaptation:** dd32a5550, a5a3c2639 (CSS-only number sizing replaces the fork's JS fix), 107aebbff, 991c2f7d0 (YNAB4 notes), 52ac1f91e, 3c60bf675.
- **Optional features:** 984ce4803 (notifications restyle), c679c5825 (commit hash on builds), 3d6a849b0 (hide reconciled in all accounts), 8fba0e87c (zero-based axis), cef7e63bf / cba8cbd3f / 50a488481 (Monte Carlo), 89384e0b7 (`getScheduleDates`; its api `vite.config` fix is worth taking either way).

## Decisions for you

| sha                             | what                                                                                          | trade-off                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1ad8477ab                       | Rule formulas use amounts instead of cents                                                    | Breaks existing user formulas (`=amount/100`) with no migration, and it conflicts with the fork's currency-aware formula fix. If skipped, future upstream formula commits will conflict. |
| 9732a4463                       | Automatic background bank sync                                                                | Large feature. Decide how it should interact with the CLI's guarded imports.                                                                                                             |
| 8e165c0eb                       | Standard Button/Text/Input sizes (117 files)                                                  | Cosmetic, but later upstream UI commits depend on it.                                                                                                                                    |
| 0d292335f, 93c1857fa, 425a0a0f0 | Settings redesign; Payees, Rules, Bank sync and Tags move into Settings; configurable sidebar | About an hour of conflicts. Re-add the fork's `budgetReservations` toggle.                                                                                                               |
| 18cc7da0d, fdf7f1b8c            | Mobile bottom-sheet menus; remove the sidebar budget dropdown                                 | Large UI changes; both need 8e165c0eb.                                                                                                                                                   |
| 01dadbcae, fab0ab1b9            | Tag-split custom reports                                                                      | Backend plus UI; changes tag regex generation.                                                                                                                                           |
| 8d59f30cf                       | Monte Carlo investment phases                                                                 | Needs the earlier Monte Carlo commits.                                                                                                                                                   |
| 63180ceea, bde50c3be            | October dependency bump; new lint rules                                                       | Rebuild yarn.lock with `yarn install`. The new lint rules will flag fork-only code.                                                                                                      |
| 3a77479e1                       | Release 26.10.0                                                                               | Bumps every version, including the CLI. Apply last or skip.                                                                                                                              |

## Skip

- **Already fixed in the fork, or would undo a fork fix:**
  - ccdd1cff1: same fix.
  - dd224f6df: the fork's version also handles "before" mode.
  - 27290a899, 9e80790d6: already covered by fork fixes.
  - bba0c997a: would bring back payee-named Sankey nodes.
  - 4f28d63ec: the fork has its own Windows build fix.
  - ddee2cca9: already in the lockfile.
- **Upstream docs, CI and release infrastructure:** 6d224f676, 815286d25, 421f16638, 603a905f9, 3ef90fe59, 74ae62609, c21df10cc, f3b8f85b2, 6245a4641, 5240d5b05, aa5c8841c, 48cac5930, 68d18f19f, e27f2f6c4, d5d6035a8, ffc68afae.

## Watch-outs

- **Order dependencies:**
  - a3330d2f5 needs 24deae74e.
  - 821caa264 needs 2dc69b3de.
  - 148e5c233 needs 137922fd6.
  - a771f8280 needs 0728f1a30.
  - 7474a9429, 6e68ee1de and e4ee6935d need 42e9d79d4.
  - cc368d10c needs a264f7403.
  - fab0ab1b9 needs 01dadbcae and 52ac1f91e.
  - 18cc7da0d and fdf7f1b8c need 8e165c0eb.
- **Behaviour changes:**
  - After 42e9d79d4, every password login creates a new session, and API `shutdown()` revokes sessions it created. Check the CLI's password and session-token flows.
  - 38de5cadb changes how self-signed certificates are trusted.
  - 7474a9429 blocks LAN SimpleFIN bridges unless they are allow-listed.
