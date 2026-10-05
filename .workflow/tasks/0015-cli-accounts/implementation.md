# Implementation: 0015 cli-accounts

## Slice 1: account inspection (A1)

- Core `packages/loot-core/src/server/accounts/inspect.ts`, handler `api/accounts-inspect`, public `inspectAccounts({ cutoff, includeClosed })`.
- CLI `accounts inspect [--cutoff] [--include-closed]` in `packages/cli/src/commands/accounts.ts`.

## Slice 2: account groups (A2)

- Core `packages/loot-core/src/server/account-groups/guarded.ts` (prepare/perform for create, update, delete), types in `types/change-proposals.ts`, handlers in `server/api.ts`.
- Public `previewAccountGroupCreation|Update|Deletion` and `apply...` in `packages/api/methods.ts`.
- CLI `packages/cli/src/commands/account-groups.ts`, adapters in `guarded-changes.ts`, journal expiry for creations, `accounts update --account-group-id <id|none>`.

## Verification (Linux)

| Check    | Command                                             | Result                                                                |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`               | 292/292                                                               |
| API unit | `yarn workspace @actual-app/api test`               | 125/125 (account inspection and guarded account group cases included) |
| Types    | `npx tsc -b packages/loot-core`, API and CLI `tsc`  | clean                                                                 |
| Packaged | `node --test integration/accounts-inspect.test.mjs` | 1/1 (`verification-accounts-linux.txt`)                               |

Limitations: Windows not run; no browser check of group display; opening-balance preview not separate.

Decision audit: D1-D7 in execution-decisions.md.
