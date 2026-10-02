# Task Progress: Packaging, cross-platform documentation, and upgrades

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0031-cli-workflows](../0031-cli-workflows/progress.md), [0010-cli-runtime](../0010-cli-runtime/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add packed-artifact smoke tests and version/capability negotiation across CLI/API/server.
- [ ] Document installation, secrets, first-run setup, offline/sync, previews, error codes, recovery, and personal cash workflows.
- [ ] Add schema/journal migration fixtures and release notes; collect Windows/Linux build/type/lint evidence without publishing packages.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                    | Evidence      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Install local packed artifacts in isolated clean directories and run schema/context/setup/import/backup workflows.                  | Not collected | Pending |
| A2  | PowerShell and bash examples execute with paths containing spaces and JSON/stdin safely.                                            | Not collected | Pending |
| A3  | Supported previous configuration/receipt versions migrate deterministically or return actionable incompatibility without data loss. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
