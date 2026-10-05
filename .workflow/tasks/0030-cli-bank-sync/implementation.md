# Implementation: 0030 cli-bank-sync

## Slice 1: capability and health metadata

- Core `server/accounts/bank-sync-status.ts`: `bankSyncStatus` (linked accounts, provider, institution, last sync, persisted `bank_sync_status`, provider `configured` flags from the existing status handlers; no secrets). Handler `api/bank-sync-status`; public `getBankSyncStatus`; CLI `bank-sync status` (read).

## Slice 2: per-account refresh and receipts

- `bankSyncRefresh` over the engine's existing `accounts-bank-sync` and `simplefin-batch-sync` (D2, D3, D6). Handler `api/bank-sync-refresh`; public `refreshBankSync`; types `BankSyncAccountOutcome`, `BankSyncAccountStatus`, `BankSyncOutcomeStatus`, `BankSyncProviderState`.
- CLI `bank-sync refresh [--accounts]` with device-local run records and `bank-sync results [run-id]` (D4, `packages/cli/src/bank-sync-runs.ts`).
- Sync server: SimpleFIN HTTP 429 maps to `RATE_LIMIT_EXCEEDED` (D5).

## Slice 3: fake provider proof and consent boundary

- `integration/bank-sync.test.mjs` with a fake SimpleFIN server and `integration/bank-link.mjs` (engine link handler in a helper process) (D7).
- Docs: `cli.md` Bank sync section, README row, `upcoming-release-notes/agent-cli-bank-sync.md`.

## Verification (Linux)

| Check    | Command                                      | Result                                      |
| -------- | -------------------------------------------- | ------------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`        | 321/321 (adds `commands/bank-sync.test.ts`) |
| Types    | loot-core, API and CLI `tsc`                 | clean                                       |
| Packaged | `node --test integration/bank-sync.test.mjs` | 1/1 (`verification-bank-sync-linux.txt`)    |

Acceptance mapping:

- A1: with a fake SimpleFIN provider and two linked accounts, a repeated feed adds nothing (duplicates matched by import ID); a one-account refresh asks the provider for that account only and imports exactly the new transaction; when the provider stops returning one account, that account is `account-missing` while the other is `no-new-transactions`; an HTTP 429 gives `rate-limited` (retryable) for every account.
- A2: before any link, `bank-sync status` reports zero linked accounts, the consent prerequisite and SimpleFIN not configured; `bank-sync refresh` returns the prerequisite and `--accounts <unlinked>` gives `not-linked`, with no provider request and no new account. An HTTP 403 (expired access) gives `auth-required` with a reauthentication prerequisite, persists `reauth-required`, and creates no connection. Status output never contains the access key.
- A3: each refresh result states that an empty feed is not verified coverage; runs are recorded `synced` after the push, and a failed push keeps the run `committed-local` with its run ID and outcomes (unit test with a failing push).

Limitations: Windows not run. Only the SimpleFIN path was exercised end to end; GoCardless and Pluggy accounts use the same per-account wrapper over `accounts-bank-sync` but have no fake provider here. The failed-push path is unit-tested, not packaged.

Decision audit: D1-D7 in execution-decisions.md.
