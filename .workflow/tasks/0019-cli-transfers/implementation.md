# Implementation: 0019 cli-transfers

## Slice 1: candidates, inspection and audit (read-only)

- Core `packages/loot-core/src/server/transfers/inspect.ts`: `findTransferCandidates`, `inspectTransfer`, `auditTransfers`, `classifyTransfer` (uses `transferClearsCategory` from the engine's transfer owner).
- Handlers `api/transfers-candidates`, `api/transfers-inspect`, `api/transfers-audit`; public `findTransferCandidates`, `inspectTransfer`, `auditTransfers`.
- CLI `transfers candidates|inspect|check` (read operations in the agent contract).

## Slice 2: guarded match, unmatch and repair

- Core `packages/loot-core/src/server/transfers/guarded.ts`: `prepare`/`perform` for `transfers.match`, `transfers.unmatch`, `transfers.repair`. Match and unmatch write through `batchUpdateTransactions` with transfer creation off and verify both legs; repair `resync`/`relink` run the engine's transfer owner for the row and verify the link afterwards.
- Types `TransferMatch*`, `TransferUnmatch*`, `TransferRepair*`, `TransferLegSnapshot` in `change-proposals.ts`; handlers `api/transfers-preview-*` and `api/transfers-apply-*`; public `previewTransferMatch`, `applyTransferMatch`, `previewTransferUnmatch`, `applyTransferUnmatch`, `previewTransferRepair`, `applyTransferRepair`.
- CLI `transfers match --ids`, `transfers unmatch <id>`, `transfers repair <id>` (payload-scoped guarded operations, `--operation-id` required, `--allow-reconciled`), change payload schemas, receipt outcome union.
- Docs: `cli.md` Transfers section, README row, `upcoming-release-notes/agent-cli-transfers.md`.

## Verification (Linux)

| Check    | Command                                                        | Result                                                                |
| -------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "transfer"` | 2/2 (`transfer review`, `guarded transfer match, unmatch and repair`) |
| CLI unit | `yarn workspace @actual-app/cli test`                          | 301/301                                                               |
| Types    | `npx tsc -b packages/loot-core`, API and CLI `tsc`             | clean                                                                 |
| Packaged | `node --test integration/transfers.test.mjs`                   | 6/6 incl. three process kills (`verification-transfers-linux.txt`)    |

Limitations: Windows not run. No browser check (the browser reads the same engine rows; browser-sync covers the transport).

Decision audit: D1-D7 in execution-decisions.md.
