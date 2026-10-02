# Task Progress: Optional MCP adapter over the same operation registry

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0007-cli-contract](../0007-cli-contract/progress.md), [0031-cli-workflows](../0031-cli-workflows/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add a thin adapter package or entry using a pinned compatible official MCP SDK; keep executor ownership in CLI/shared operations.
- [ ] Expose domain tool discovery/resources and stdio lifecycle with schema parity tests.
- [ ] Add agent configuration examples and end-to-end protocol tests; optional MCP failure does not block CLI-only release.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                            | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | The same summary/import preview/scenario inputs produce identical CLI and MCP data and no extra writes.                                     | Not collected | Pending |
| A2  | Tool schemas are generated from the registry with no drift; unknown tools/inputs fail before engine execution.                              | Not collected | Pending |
| A3  | A protocol client can discover a domain, perform a read, preview/apply a permitted change, cancel, and reconnect using a disposable budget. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
