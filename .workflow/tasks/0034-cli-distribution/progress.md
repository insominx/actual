# Task Progress: Packaging, cross-platform documentation, and upgrades

Current status: completed locally on Linux; Windows rerun pending (PowerShell tutorial not executed)
Current phase: three slices implemented and verified on Linux

## Dependencies

[0031-cli-workflows](../0031-cli-workflows/progress.md), [0010-cli-runtime](../0010-cli-runtime/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add packed-artifact smoke tests and version/capability negotiation across CLI/API/server.
- [x] Document installation, secrets, first-run setup, offline/sync, previews, error codes, recovery, and personal cash workflows.
- [x] Add schema/journal migration fixtures and release notes; collect Windows/Linux build/type/lint evidence without publishing packages.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                    | Evidence                                                                                                                               | Status       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A1  | Install local packed artifacts in isolated clean directories and run schema/context/setup/import/backup workflows.                  | `distribution.test.mjs` (packed case with `ACTUAL_TEST_PACKED=1`), `src/upgrade-check.test.ts` (`verification-distribution-linux.txt`) | Met on Linux |
| A2  | PowerShell and bash examples execute with paths containing spaces and JSON/stdin safely.                                            | `distribution.test.mjs` (packed case with `ACTUAL_TEST_PACKED=1`), `src/upgrade-check.test.ts` (`verification-distribution-linux.txt`) | Met on Linux |
| A3  | Supported previous configuration/receipt versions migrate deterministically or return actionable incompatibility without data loss. | `distribution.test.mjs` (packed case with `ACTUAL_TEST_PACKED=1`), `src/upgrade-check.test.ts` (`verification-distribution-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 04:03 PT: Added the packed-artifact smoke test, `actual upgrade check`, install/upgrade docs and bash/PowerShell first-run tutorials. Packaged `distribution.test.mjs` 3/3 (including the packed install) and unit 2/2 (CLI unit 333) on Linux. PowerShell tutorial and Windows install pending the Windows rerun. Decisions D1-D6.
