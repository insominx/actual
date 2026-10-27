# Candidate Edits from the 2026-10-21 Retrospective

Status (2026-10-21): applied with the user's approval ("do it").

- Applied: both `AGENTS.md` edits, `*.snap text eol=lf` in `.gitattributes` (snapshots checked out again as LF), and the Bash-cwd memory.
- Not applied: the full `core.autocrlf=false` renormalize. It would also need `core.eol=lf`, and it rewrites every working file. Left for the repo owner.

---

# Candidate Rule Edit: Document the working desktop-client test command

## Target

- File: `AGENTS.md`
- Section: Development Workflow → 2. Testing Strategy → Unit Tests (Vitest)
- Type: add

## Evidence

- E05: `npx vitest run --root packages/desktop-client <path>` from the repo root failed every test file, because `vite.config.mts` resolves `./src/...` against cwd. This hit the main agent once and two subagents independently. `yarn workspace @actual-app/web run test <filter>` worked every time.

## Problem

Agents can't run vitest inside the child workspace (the git-guard hook blocks yarn there). So they try `--root` from the repo root. That works for loot-core and sync-server but not for desktop-client.

## Proposed diff

```diff
 # Run tests for a specific package
 yarn workspace @actual-app/core run test
+
+# desktop-client: pass file filters through the workspace script.
+# `npx vitest --root packages/desktop-client` from the root fails, because
+# vite.config.mts resolves paths against the current directory.
+yarn workspace @actual-app/web run test src/components/autocomplete
```

## ROI score

- Outcome improvement: 2
- Retry reduction: 3
- Bug reduction: 1
- Trigger precision: 3
- Reuse frequency: 3
- Context overhead: 3
- Maintenance burden: 3
- Staleness risk: 2
- Ownership clarity: 2
- Verifiability: 3
- Total: 25/30 (promote, with approval)

## Expected benefit

No more failed full-file test runs when agents test desktop-client changes.

## Cost and risk

About 4 lines of standing context. It goes stale if the vite config changes.

## Approval needed from

Repo owner.

## Rollback/review condition

Remove once `vite.config.mts` resolves paths relative to its own file.

---

# Candidate Rule Edit: Scope formatting to changed files on autocrlf checkouts

## Target

- File: `AGENTS.md`
- Section: Cursor Cloud specific instructions → Lint, test, typecheck (and the Quick Start `yarn lint:fix` line)
- Type: add

## Evidence

- E03: `yarn lint:fix` modified about 650 unrelated files in this Windows checkout (`core.autocrlf=true`). It took a keep-list `git checkout` to recover.
- E04: CRLF-only diffs on `parse-file.test.ts.snap`, seen 7 times over 2 days.

## Problem

oxfmt writes LF, while the working tree is CRLF. Repo-wide formatting therefore touches every file whose working copy differs, and the noise hides real changes.

## Proposed diff

```diff
 - `yarn lint` / `yarn lint:fix` (uses oxlint + oxfmt)
+- On Windows checkouts with `core.autocrlf=true`, don't run `yarn lint:fix`
+  repo-wide: it rewrites hundreds of untouched files. Format and lint only
+  what you changed:
+  `git diff --name-only | xargs npx oxfmt` and
+  `git diff --name-only | grep -E '\.(ts|tsx|js)$' | xargs npx oxlint --type-aware`
```

## ROI score

- Outcome improvement: 3
- Retry reduction: 2
- Bug reduction: 2
- Trigger precision: 2
- Reuse frequency: 3
- Context overhead: 3
- Maintenance burden: 2
- Staleness risk: 2
- Ownership clarity: 2
- Verifiability: 3
- Total: 24/30 (promote, with approval)

## Expected benefit

No accidental repo-wide churn, and no risky bulk reverts.

## Cost and risk

About 5 lines of standing context. It becomes unnecessary once line endings are normalized (next proposal).

## Approval needed from

Repo owner.

## Rollback/review condition

Remove once the line-ending proposal below is applied.

---

# Candidate Config Edit: Pin snapshot line endings

## Target

- File: `.gitattributes`
- Type: add

## Evidence

- E04: 7 CRLF-only snapshot diffs over 2 days, after the 2026-10-19 no-change decision whose revisit condition was "dirty snapshot line ending diffs repeatedly escape".
- E03: the same root cause drove the 650-file formatter churn.

## Proposed diff

```diff
 # Declare files that will always have LF line endings on checkout.
 *.js text eol=lf
+*.snap text eol=lf
```

Broader option, a local one-time change for this checkout (more effective; needs the owner's decision):

```bash
git config core.autocrlf false
git add --renormalize .
git status   # expect no content changes
```

## ROI score (quick)

- Value 2, Recurrence 3, Cost fit 2. Total: 7/9

## Expected benefit

Snapshot files stop showing up as modified after test runs.

## Cost and risk

The `.gitattributes` line touches shared config, so it needs approval. The renormalize option touches the local checkout only, but it rewrites every working file once.

## Approval needed from

Repo owner.

## Rollback/review condition

Revert if contributors on macOS or Linux report new diffs.

---

# Memory Candidate: Bash cwd persists across calls

- Evidence: E02. One `cd` into a deep directory made the next 7 relative-path commands fail.
- Proposed memory (feedback): "In the Bash tool, cwd persists between calls. Use absolute paths, or a `R=/abs/path` prefix, instead of `cd`. If you must `cd`, do it inside a subshell `( cd … && … )`."
- Quick score: 7/9. Applies to every session with zero task-specific cost.
- Decision: offer to save. Not applied.

---

# No-Change Decision: Codify the subagent verify-and-fix brief as a skill

## Considered change

A reusable skill for "fan out reviewers → verify → fix with disjoint file ownership".

## Evidence reviewed

- E10: 7 parallel fix agents finished with no conflicts.
- E01: one wave was lost to rate limits.

## Why not changing now

It was seen in one session only. The brief is short enough to write inline, and the scope split is task-specific.

## Revisit condition

The same brief gets rewritten from scratch in 2 or more later sessions.
