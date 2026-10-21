# Candidate Rule Edit: Windows-Aware Code Searching

## Target

- File: `AGENTS.md` (or `.cursor/rules/windows-tools.mdc`)
- Section: Development Workflow / Common Development Tasks
- Type: add

## Evidence

- E01: In Windows PowerShell environment, executing `rg` failed with `The term 'rg' is not recognized as a name of a cmdlet...`, requiring fallback to `git grep`.

## Problem

Coding agents operating on Windows developer machines frequently attempt to use Unix utilities (such as `rg`, `sed`, `awk`) that may not be available on Windows PATH, causing command failure turns.

## Proposed diff

```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -62,6 +62,10 @@ yarn test:debug              # Equivalent to: lage test --no-cache --continue

 - **ALWAYS run yarn commands from the root directory** - never run them in child workspaces
 - Use `yarn workspace <workspace-name> run <command>` for workspace-specific tasks
+- On Windows shell environments, prefer `git grep` over `rg` for text searching across the repository to ensure portable cross-platform execution.
 - Tests run once and exit by default (using `vitest --run`)

 ### ⚠️ PR titles must start with `[AI]`
```

## ROI score

- Outcome improvement: 2
- Retry reduction: 2
- Bug reduction: 1
- Trigger precision: 2
- Reuse frequency: 3
- Context overhead: 3
- Maintenance burden: 3
- Staleness risk: 3
- Ownership clarity: 2
- Verifiability: 3
- Total: 24/30 (Threshold: 24-30: keep, promote, or create; requires human approval before editing shared policy).

## Expected benefit

Prevents command execution failures across Windows dev environments during codebase search operations.

## Cost and risk

Minimal context overhead (+1 line in `AGENTS.md`). No risk to existing workflows.

## Approval needed from

Repository maintainers.

## Rollback/review condition

Revert if `rg` is installed or vendored as a default prerequisite in the dev container/environment.

---

# No-Change Decision: Strict Snapshot LF Enforcer in Git Config

## Considered change

Adding mandatory `.gitattributes` rule for `*.snap text eol=lf` to prevent CRLF warnings on Windows.

## Evidence reviewed

- E05: Git displayed `warning: in the working copy of '...test.ts.snap', LF will be replaced by CRLF the next time Git touches it` during file operations.

## Why not changing now

Git line ending configurations may conflict with developer global `core.autocrlf` preferences. The existing pre-commit hooks and `git checkout` resolution cleanly prevent dirty snapshot commits without imposing repository-wide git configuration changes.

## Revisit condition

Revisit if dirty snapshot line ending diffs repeatedly escape into pull requests from Windows contributors.
