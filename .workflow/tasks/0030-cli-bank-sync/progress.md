# Task Progress: Configured bank-sync diagnostics and controlled refresh

Current status: completed locally on Linux; Windows rerun pending
Current phase: three slices implemented and verified on Linux

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D4 (direct refresh with run records instead of preview/apply) and D5 (sync-server SimpleFIN 429 mapping).
- [ ] Michael (HITL): real provider connections are configured only by you in the app; no real credential was used.

## Implementation checklist

- [x] Expose provider/account capability and health metadata without secrets through existing API boundaries.
- [x] Wrap existing bank-sync execution with per-account results and mutation/import receipt semantics.
- [x] Add controlled fixture provider tests and document manual consent boundaries; do not activate personal automatic connections.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                            | Evidence                                                                                | Status       |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| A1  | Disposable fake-provider responses exercise duplicate imports, one-account refresh, partial failures, and rate limiting.    | `bank-sync.test.mjs`, `commands/bank-sync.test.ts` (`verification-bank-sync-linux.txt`) | Met on Linux |
| A2  | No connection or expired credentials returns a structured prerequisite without creating a provider connection.              | `bank-sync.test.mjs`, `commands/bank-sync.test.ts` (`verification-bank-sync-linux.txt`) | Met on Linux |
| A3  | Post-import sync failure remains committed-local/pending; an empty feed is not interpreted as verified historical coverage. | `bank-sync.test.mjs`, `commands/bank-sync.test.ts` (`verification-bank-sync-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 03:40 PT: Implemented `bank-sync status|refresh|results` over the engine's bank sync with per-account outcomes, device-local run records and SimpleFIN rate-limit mapping. Packaged `bank-sync.test.mjs` 1/1 with a fake SimpleFIN provider and unit 1/1 on Linux. Decisions D1-D7. Completed locally on Linux.
