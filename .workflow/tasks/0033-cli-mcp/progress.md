# Task Progress: Optional MCP adapter over the same operation registry

Current status: completed locally on Linux (live MCP host E2E blocked); Windows rerun pending
Current phase: three slices implemented and verified on Linux

## Dependencies

[0007-cli-contract](../0007-cli-contract/progress.md), [0031-cli-workflows](../0031-cli-workflows/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add a thin adapter package or entry using a pinned compatible official MCP SDK; keep executor ownership in CLI/shared operations.
- [x] Expose domain tool discovery/resources and stdio lifecycle with schema parity tests.
- [x] Add agent configuration examples and end-to-end protocol tests; optional MCP failure does not block CLI-only release.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                            | Evidence                                                                                        | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ |
| A1  | The same summary/import preview/scenario inputs produce identical CLI and MCP data and no extra writes.                                     | `mcp.test.mjs` (raw and official SDK clients), `src/mcp.test.ts` (`verification-mcp-linux.txt`) | Met on Linux |
| A2  | Tool schemas are generated from the registry with no drift; unknown tools/inputs fail before engine execution.                              | `mcp.test.mjs` (raw and official SDK clients), `src/mcp.test.ts` (`verification-mcp-linux.txt`) | Met on Linux |
| A3  | A protocol client can discover a domain, perform a read, preview/apply a permitted change, cancel, and reconnect using a disposable budget. | `mcp.test.mjs` (raw and official SDK clients), `src/mcp.test.ts` (`verification-mcp-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 03:58 PT: Implemented `actual mcp serve` (stdio, no SDK dependency) with registry-generated domain tools, resources, input validation before execution, child-process execution of the CLI, cancellation and reconnect. Packaged `mcp.test.mjs` 2/2 including the official SDK 1.32.0 client, unit 4/4 (CLI unit 331) on Linux. Live MCP host E2E blocked: no host application or credentials in this environment. Decisions D1-D8.
