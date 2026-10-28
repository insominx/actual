Last Edited: 2026-10-28

# Task Progress: remove GitHub CI from the fork

Current status: complete; delivered by the commits that add this file (fast-forwarded onto `master` and pushed; no PR, because `gh` is not authenticated on this machine)
Current phase: removal, tooling fixes, review and verification done
Execution path: AFK (the owner was unavailable)
Verdict: GitHub CI is gone from the fork. Every report GitHub showed was one of three things: a failure caused by this fork's settings, secrets, runner labels or branch layout; a check that a later commit had already satisfied; or a real regression that earlier commits had already fixed. Nothing was red in the code at `8d0941be9`. The local gates now replace CI.

## Request

The owner asked on 2026-10-28 to "remove all github ci workflow stuff and fix why it is currently failing" and to "fix all issues starting with breakage from what github tests are reporting".

## What GitHub was reporting

Source: the public Actions API for `insominx/actual` (124 runs: 77 success, 28 skipped, 17 failure, 2 queued) and the annotation on each failed job.

| Report                                                                                                     | Cause                                                                                                                                                                  | Kind               | Resolution                                                              |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| Dependency Review failed on every PR run (4 of 4)                                                          | The repository's Dependency graph is off: "Dependency review is not supported on this repository"                                                                      | Fork settings      | Workflow removed                                                        |
| Compare Sizes failed on every PR run (4 of 4) after a 30-minute poll                                       | It needs a successful `build.yml` run for the PR's base commit; the CI-only PRs #3 and #4 used base `ci/e2e-base`, which never had one                                 | Fork branch layout | Workflow removed                                                        |
| VRT Update - Apply failed once: "Input required and not supplied: token"                                   | The `ACTIONS_UPDATE_TOKEN` secret does not exist on the fork                                                                                                           | Fork secrets       | Workflow removed                                                        |
| Publish iOS and Publish Mac App Store sat queued (runs 40645152803 and 40644934996, both on `8d0941be9`)   | Both are scheduled (`0 1 * * *`) with `runs-on: depot-macos-latest`; the fork has no Depot runner, and the upstream sync brought them in ungated (#9314, #9327, #9330) | Fork runner labels | Workflows removed                                                       |
| Release notes failed once, on PR #2's first commit `ae7444178`                                             | The check wants a new file in `upcoming-release-notes/`                                                                                                                | Already satisfied  | `721fc10f5` added the note; workflow removed                            |
| E2E Tests failed on PR runs at `6413f6d2e`, `86b397b6a` and `86ed9c540` (functional, VRT and desktop jobs) | The fork's UI differs from upstream's tests and committed Linux screenshots                                                                                            | Code               | Fixed in `86ed9c540` and `f91535e37`; every suite passed at `f91535e37` |
| Check Spelling (Docs) failed at `fa624c033` and `3289fa5e3`                                                | "unparseable" in `packages/docs/docs/api/cli.md`                                                                                                                       | Code               | Fixed in `6413f6d2e`                                                    |
| Test (lint job) failed at `fa624c033` and `3289fa5e3`                                                      | 29 files left unformatted after the sync                                                                                                                               | Code               | Fixed in `6413f6d2e`; Test, Build and CodeQL were green at `8d0941be9`  |
| Notices on every PR run                                                                                    | `pull_request_target` is restricted by default from 2026-12-02; `ubuntu-latest` is moving to Ubuntu 26                                                                 | Platform notice    | Moot without workflows                                                  |

Other workflows would have failed or hung on first use but had not fired yet: `docker-release.yml` (tag push, no Docker Hub secrets), and `publish-flathub.yml` and `publish-microsoft-store.yml` (release event, no assets or secrets). `issues-feature-implemented.yml` ran once and succeeded (on PR #2's merge), but it is hard-wired to the upstream repository, so it would act on upstream PR numbers.

All four PRs on the fork (#1 to #4) were already closed and the `ci/*` branches were already deleted, so nothing was left open and failing. The remaining red was run history plus the two queued scheduled runs.

## What was removed

51 tracked files, in one commit:

- `.github/workflows/`: all 41 workflows.
- `.github/actions/`: the `setup`, `release-notes/check`, `release-notes/generate`, `docs-spelling` and `app-store-connect-publish` actions, and `handle-feature-requests.js`.
- `.github/scripts/count-points.mjs`.
- `.github/actionlint.yaml` and `.actrc` (the `act` runner config).

The last commit that still has them is `8d0941be9`. To bring them back:

    git checkout 8d0941be9 -- .github/workflows .github/actions .github/scripts .github/actionlint.yaml .actrc

## What was kept, and why

- `packages/ci-actions`: the docs build imports it, and `yarn generate:news-feed` runs from it (D2).
- `.github/agents/pr-and-commit-rules.md` (imported by `CLAUDE.md`), `.github/PULL_REQUEST_TEMPLATE.md` (the PR rules and the `pr-template-blank` hook need it) and `.github/hooks/impeccable.json` (agent tooling): not CI.
- `.github/ISSUE_TEMPLATE/*` and `.github/FUNDING.yml`: not CI. Issues are disabled on the fork, so the templates are unused; the tech-support template still says such tickets are closed automatically, which is no longer true and is harmless.
- `.coderabbit.yaml`, `CODEOWNERS`, the Dockerfiles and `docker-compose.yml`: a review-bot config, ownership data and product packaging, not CI workflows.

## Changes that go with the removal

| File                                                                                                                 | Change                                                                                                                                | Why                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `knip.json`                                                                                                          | `packages/ci-actions` entry is `bin/*.{ts,mjs}`; the root workspace ignores `@octokit/rest`, `minimatch` and `p-limit`                | D3, D4                                          |
| `.claude/skills/running-vrts/SKILL.md`                                                                               | The no-Docker fallback no longer says CI generates snapshots; the `/update-vrt` trigger and the "CI ignores" wording are gone         | The workflow is gone                            |
| `.claude/skills/writing-actual-docs/SKILL.md`                                                                        | Dropped the instruction to edit `typos.toml` and the "spelling allowlist" wording; told agents to ignore the guide's spelling section | The file and the check are gone                 |
| `.claude/skills/committing-actual-changes/SKILL.md`                                                                  | Dropped the claim that the `[AI]` prefix drives an automatic label                                                                    | The labeling workflow is gone                   |
| `AGENTS.md`                                                                                                          | One bullet: no GitHub Actions workflows, which gates to run (with the Windows caveats), the VRT route and the sync rule               | D5, D6                                          |
| `packages/cli/ARCHITECTURE.md`, `packages/loot-core/migrations/README.md`, `schema-diff.ts`, `generate-news-feed.ts` | Corrected statements that CI runs or regenerates something                                                                            | D8                                              |
| Two `atomic-write.test.ts` files                                                                                     | Skip the symlink tests where symlinks are not permitted                                                                               | D7                                              |
| `.workflow/README.md`, `.workflow/tasks/0037-upstream-sync/progress.md` and `implementation.md`                      | The 0037 status lines said "not pushed", "VRT pending" and "not applied: `fd08b56ee`"; they now match what happened                   | The README row for 0037 was already out of date |

## Verification

Run on the final tree on 2026-10-28, in addition to four independent read-only reviews (dangling references, gates, ledger accuracy, completeness). The reviews found no blocker once a stray `news.json` change, left by a reviewer's regeneration check, was restored.

| Gate                                                                                     | Result                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn constraints`, `yarn check:tsconfig-references`                                     | Pass                                                                                                                                                                                                                                                                                                     |
| `yarn typecheck`                                                                         | Pass in every package                                                                                                                                                                                                                                                                                    |
| `yarn test` (full, lage)                                                                 | Pass. `web`, `core`, `cli` and `ci-actions` re-ran; `api`, `components`, `crdt`, `desktop-electron`, `eslint-plugin-actual` and `sync-server` were cache hits on unchanged inputs (`sync-server` ran green at 09:08 with the symlink skips already in place)                                             |
| The two `atomic-write` suites                                                            | `core`: 3 passed, 3 skipped. `sync-server`: 2 passed, 3 skipped. Each suite's third skip is the Windows-only permissions test that was already skipped                                                                                                                                                   |
| `oxfmt --check` on the 16 changed files, `oxlint --type-aware` on the 4 changed TS files | Pass                                                                                                                                                                                                                                                                                                     |
| `yarn knip`                                                                              | Exits 1 on this Windows checkout, and the report is identical to the report before the removal (the four `.husky` items and 42 configuration hints). Negative control: with `knip.json` as it was at `8d0941be9`, the same tree reports four unused `ci-actions` scripts and four unused devDependencies |
| Docs import                                                                              | `@actual-app/ci-actions/src/release-notes/util.mjs` resolves from `packages/docs` (exports `categoryAutocorrections`, `categoryOrder`, `formatNotes`, `parseReleaseNotes`)                                                                                                                               |
| Kept files                                                                               | Every file listed under "What was kept" is present; nothing outside the 51 deletions and the edits above changed                                                                                                                                                                                         |
| Not re-run                                                                               | Builds (`yarn build:server`, the `validate-cli` smoke), e2e and VRT (no Docker here). The edits are tests, comments, docs and config, and the last green CI run covered those suites at `f91535e37`                                                                                                      |

## What the fork loses

- VRT screenshot regeneration through CI. `vrt-update-generate.yml` produced the 146-file refresh in `f91535e37` (D20 of task 0037). The faithful route now is `yarn vrt:docker`: it needs Docker and a POSIX shell (Git Bash or WSL), and Docker Desktop may need host networking. This machine has no Docker. Task 0035 (D12) once adopted baselines generated on a plain Linux host instead, with a fidelity caveat. About 468 committed snapshots and every future upstream UI sync depend on this route, so test it once before relying on it.
- Linux and macOS verification. The functional, desktop and VRT e2e suites, the API browser e2e and the Capacitor mobile build existed only in CI. This machine is Windows with `core.autocrlf=true`.
- The two upstream `atomic-write` symlink tests now run nowhere on this machine (D7). Windows Developer Mode, or running `yarn test` under WSL, makes them run again.
- The news-feed drift check (`news-feed-check.yml`) and the autofix commits. Regenerate `news.json` only from an LF checkout; with `core.autocrlf=true` the generator embeds `\r\n`.
- Installers and build artifacts per PR (Linux, Windows and macOS Electron builds), CodeQL results and Docker image publishing.
- PR automation: the bundle-size table, the migration warnings comment, the label and do-not-merge gates, and the release-notes and crdt-version policy checks.
- Nothing gates `master` any more except local discipline. The public API shows `master` is not protected and has no rulesets (checked 2026-10-28), so no required check can hang.

## Follow-ups for the owner

- Cancel the two queued runs: https://github.com/insominx/actual/actions/runs/40645152803 and https://github.com/insominx/actual/actions/runs/40644934996 ("Cancel workflow run"). Pushing the removal does not cancel them. Until they are cancelled, `8d0941be9` shows as pending on GitHub. GitHub documents an automatic cancel after 24 hours for self-hosted runners, which would land around 06:37 UTC on 2026-10-29; that is unconfirmed for this label.
- In the repository settings (Settings > Actions > General), disable Actions. It is the only mechanical guard against a future sync re-adding a workflow (D5), and it needs your login. It is optional once the files are gone.
- Two merged remote branches, `upstream-sync-2026-10` and `workflow/complete-remaining-tasks`, still contain the old workflows. Delete them, or a push to either would run them.
- Install Docker (or WSL) if you want to regenerate VRT screenshots, and enable Windows Developer Mode if you want the symlink tests to run here.
- `jq` was installed with winget (user scope) because the repo's agent hooks require it. It takes effect in new shells, so restart Claude Code to get the hooks working. Until then, the Write hook blocked new files in this session, so the two files of this task were created with PowerShell, and the format-on-edit hook did not run; the changed files were formatted by hand with `oxfmt`.
