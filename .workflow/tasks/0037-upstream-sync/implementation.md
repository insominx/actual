# Implementation: 0037 upstream-sync

Branch: `upstream-sync-2026-10`, from `master` at `9b1ca1b24`. Upstream pin: `80f7518c8`.
Every commit is a `git cherry-pick -x` (the upstream SHA is in the body) with the `[AI]` prefix. Adapted picks say what changed in an `Adapted:` line.

## Applied

| Wave                  | Commits                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Notes                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1 Security            | 42e9d79d4, e4ee6935d, 38de5cadb, 0c571bc47, 7474a9429; dependency bumps f68fd9a47, 3cb34d249, 987747f6f, 01060f636, plus 954ad61d3 + 358823017 as one `yarn up -R` commit                                                                                                                                                                                                                                                                                                    | 42e9d79d4 adapted in 6 files; see below                 |
| 2 Clean data fixes    | 24deae74e, 2dc69b3de, 821caa264, af7c06fcb, 18e995513, db42f652e, 952aa2a67, 7e683249a, c65884a27, c58e6c5dc, df4dc0d6c, e35036803, 1c852e488, 167bae44f, 3234be04d, 046239693, 638c9bc34, ef0f0614a                                                                                                                                                                                                                                                                         | All clean                                               |
| 3 Adapted data fixes  | a3330d2f5, b490e3e76, 3ea257434, a264f7403, cc368d10c, 253823d39, 9b4e30425, 61775be12 (renderer half), d2dae07f5, f36804f04, 1eeffe327, 6e68ee1de                                                                                                                                                                                                                                                                                                                           | 6e68ee1de was missing from the triage waves; added here |
| 4 Performance         | cf34c0e3b, 137922fd6, 148e5c233, 0f000bf69, 0728f1a30, a771f8280                                                                                                                                                                                                                                                                                                                                                                                                             | Required order kept                                     |
| 5 UI fixes and extras | dd32a5550, 967684afa, 2420942e8, eb28966d6, 6da9f6ac7, 7f74953a5, 5e39105f5, a74830ff8, 34597d703, ca9892b85, 2e68845ed, 984ce4803, 3c60bf675, c72ce699b, 4cfa91467, 231e43bbe, 6ee7900cf, 4aad1489d, cef7e63bf, a5a3c2639, ec78d7c4d, 76fb680bc, c4ccbf953, ed785afa0, 64be9c389, c59c4979e, c679c5825, 89384e0b7, 52ac1f91e, 991c2f7d0, 107aebbff, cba8cbd3f, 832f43da6, 4ae0f078e, b26aef9ba, 08b0deaf6, 8c2fa0e86, 50a488481, 3d6a849b0, 8fba0e87c, 7cd04aaf0, 80f7518c8 | ca9892b85 was missing from the triage; added here       |

## Fork invariants kept

- `token_expiration` stays in seconds for password logins (42e9d79d4 would have multiplied it by 60).
- The null guard on the password-login user lookup is kept.
- `importBuffer(fileData, buffer, { newName, localId })`: upstream's `localId` joins the fork's options object. Local imports keep `cloudFileId: null`.
- The API browser shutdown signs out through the fork's `stopWorker` teardown.
- EnableBanking `/configure` keeps the fork's existing `not-admin` 403.
- Rules: `runRules` keeps the fork's `dryRun` argument. The editors keep the fork's try/catch around rule runs (a264f7403, cc368d10c).
- `looselyParseAmount` keeps the fork's trailing-minus handling and takes upstream's currency-suffix regex.
- Coordinator: keeps the fork's disconnect path and drops the duplicate role-change posts.
- The Electron save handler stays the fork's. Only the renderer awaits were taken from 61775be12.
- Sync events keep the fork's tag and account-group invalidations alongside upstream's dashboard and report ones.
- The fork's SQL `REGEXP` now also skips nested-repeat patterns, as rule conditions already did.
- Monte Carlo docs keep the fork's screenshots.

## Test file splits

Both sides added a test file at the same path with incompatible module mocks, so upstream's copy got its own file:

- `packages/sync-server/src/accounts/openid-logging.test.ts`
- `packages/desktop-client/src/sync-events-dashboard.test.ts`

## Not applied (owner decisions D1–D10, plus the skip list)

See `execution-decisions.md`. Upstream `6ef6d303d` (after the pin) is out of scope.

## Verification

See the per-wave gate results in `progress.md`. The final gate at `9ec589b24` passes typecheck and all seven suites.

## Fork commits added during the sync

- `6f6712506`: format fixes.
- `83c7015e3`: fit upstream tests to the fork's pinned test date and to the reservation refresh's `resetQueries`.
- `0e6ec8f17`: fix the fork's `getNextDateAfter`, which skipped the occurrence after a weekend-moved one (D18).
- `9ec589b24`: rebuild `AllAccountsMenuModal` without D3/D5 (D19), and give the YNAB4 doImport tests a database.

## Known gaps

- VRT screenshots were not regenerated: the Docker daemon was not running. Upstream PNGs from clean picks are upstream renders. For 8fba0e87c, the fork's balance-forecast PNGs were kept. Run `yarn vrt:docker` scoped to `reports.test.ts`, `onboarding`, and the touched mobile and settings tests before relying on VRT.
- The Electron e2e suite (`yarn e2e:desktop`) was not run.
