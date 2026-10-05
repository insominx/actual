# @actual-app/cli

Command-line interface for [Actual Budget](https://actualbudget.org). Query and modify your budget data from the terminal — accounts, transactions, categories, payees, rules, schedules, and more.

The CLI connects to a running Actual sync server. Explicit offline mode also supports existing local budgets and downloaded caches.

## Installation

```bash
npm install -g @actual-app/cli
```

Requires Node.js >= 22.18.0.

## Quick Start

```bash
# Set connection details
export ACTUAL_SERVER_URL=http://localhost:5006
export ACTUAL_PASSWORD=your-password
export ACTUAL_SYNC_ID=your-sync-id   # Found in Settings → Advanced → Sync ID

# List your accounts
actual accounts list

# Check a balance
actual accounts balance <account-id>

# View this month's budget
actual budgets month 2026-03
```

## Managed local server

The CLI can configure and supervise an installed Actual sync server. Managed servers bind to `127.0.0.1`. They run as hidden background processes on Windows. The CLI does not install a system service or package.

```bash
actual server init --server-dir /private/actual-server --port 5006
actual server start --server-dir /private/actual-server
actual server status --server-dir /private/actual-server
actual --server-url http://127.0.0.1:5006 server bootstrap
actual --server-url http://127.0.0.1:5006 connection test
actual --server-url http://127.0.0.1:5006 doctor
actual server logs --server-dir /private/actual-server
actual server stop --server-dir /private/actual-server
```

For bootstrap, set `ACTUAL_PASSWORD_FILE` to a private password file first. Existing password/environment/profile settings also work. Bootstrap reuses the server's first-run endpoint and refuses an initialized server. It never resets a password or returns the generated session token. `connection test` authenticates without choosing a budget. `doctor` also checks the selected local or sync budget when configured.

`server init` creates device-local runtime configuration without starting or authenticating the service. It refuses to overwrite existing configuration. The server package must already be installed or built. Supply `--server-entry <path>` when it cannot be resolved. Within this repository, use `packages/sync-server/build/bin/actual-server.js` after building the server. Resolve relative paths from your current directory.

The `.actual-runtime` directory contains private configuration, ownership metadata, and lifecycle events. Protect this directory with operating-system access controls. The control token stays in private files and process environment; results and logs never expose it. Stop authenticates the supervisor, which holds the exact server child handle. The CLI never kills a process using a PID from disk. Startup checks the port and executable hash. Health responses identify the managed instance. Stop verifies the configuration and executable before acting. Stop the server before upgrading its executable.

Startup waits at most 15 seconds. Requests have bounded timeouts. When a stop response is lost, exit code 6 means the outcome is unknown; inspect status before another action. Changed executables, occupied ports, and unconfirmed ownership return structured failures. The CLI preserves uncertain ownership metadata for inspection. It does not guess that a stale PID is safe to kill.

`server logs` returns up to 100 lifecycle events from the last 64 KiB. It omits raw server output to keep credentials and provider data out of agent results. Diagnostic issues distinguish authentication, encryption, connection, incompatible metadata, missing modules, and native binding failures. A broken installation that prevents the CLI entrypoint from loading cannot return CLI JSON. Browser-dependent identity-provider setup remains outside these commands.

These commands are verified locally on Windows. Linux lifecycle behavior remains unverified. Local budget creation and publication remain the next prerequisite.

## Configuration

Configuration is resolved in this order (highest priority first):

1. **CLI flags** (`--server-url`, `--password`, etc.)
2. **Environment variables**
3. **Named device-local profile**, if selected
4. **Config file** (via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig))
5. **Defaults** (`dataDir` defaults to `~/.actual-cli/data`)

An explicit `--budget-id` selects a local budget and suppresses inherited sync IDs. An explicit `--sync-id` suppresses inherited local IDs. Supplying both flags is an error.

### Agent discovery and JSON results

```bash
actual capabilities
actual schema transactions.import
actual --output-version 2 --refresh accounts list
actual --output-version 2 context
```

`capabilities` and `schema` need no credentials, budget, or engine initialization. Their metadata comes from the registered commands. Each operation describes its options, positional arguments, JSON payload where applicable, and current capabilities.

Existing commands retain their default output. Opt in to the agent contract with `--output-version 2`. Discovery, context, and profile commands always use version 2. Version 2 requires JSON output. Help and version flags remain text.

Version 2 writes one JSON document after the command finishes. Success contains `schemaVersion`, `operation`, `context`, `data`, and `warnings`. Context includes local and sync IDs, currency, scale 100, connection mode, observed sync time, and commit status. Unknown metadata is `null` or `unknown`. A cached read does not establish that the server has no newer changes; use `--refresh` when required.

Errors contain a stable code, a message, retryability, and optional field details. Unknown engine errors use a generic message to avoid disclosing credentials. Diagnostics use stderr.

| Exit code | Error code           | Meaning                                                 |
| --------- | -------------------- | ------------------------------------------------------- |
| 2         | `INVALID_INPUT`      | The command or JSON input is invalid.                   |
| 3         | `MISSING_CONTEXT`    | Required configuration or budget selection is missing.  |
| 4         | `STALE_PREVIEW`      | Reserved for the future preview protocol.               |
| 5         | `ENGINE_FAILURE`     | The engine, authentication, lock, or connection failed. |
| 6         | `PARTIAL_COMPLETION` | Local changes committed but synchronization failed.     |

When a push fails, synchronize again instead of repeating the mutation. Preview, receipts, and reversal are not implemented yet. Discovery reports those capabilities as unavailable. Lists retain their existing payloads; paging and truncation metadata are planned separately.

### Device-local profiles and offline mode

Create a profile JSON file with connection settings and secret file references:

```json
{
  "serverUrl": "http://localhost:5006",
  "syncId": "your-sync-id",
  "dataDir": "/private/actual-cache",
  "passwordFile": "/private/actual-password"
}
```

```bash
actual profiles set personal --file profile.json
actual profiles list
actual profiles show personal
actual profiles use personal
actual --profile personal --output-version 2 context
actual --profile personal --offline --output-version 2 accounts list
actual --offline --budget-id <local-id> --data-dir <directory> --output-version 2 accounts list
```

Profiles save only device-local configuration. They never change transactions or allocations. Profile JSON rejects plaintext passwords, token values, embedded URL credentials, and unknown fields. It accepts `passwordFile`, `sessionTokenFile`, and `encryptionPasswordFile`. Protect those files with your operating system's access controls. Use absolute paths for portable selection across working directories.

The store defaults to `~/.actual-cli/profiles.json`. Override it with `--profiles-file` or `ACTUAL_PROFILES_FILE`. Select a profile with `--profile`, `ACTUAL_PROFILE`, or `profiles use`. Environment variables still override profile fields. Profile edits replace the file atomically; concurrent profile edits use the last writer's configuration.

`--offline` requires an existing local budget ID or a previously downloaded sync budget in the selected data directory. It does not download anything. It also ignores server secret files. You can use `ACTUAL_OFFLINE=true` and `ACTUAL_BUDGET_ID`, or a profile with `offline: true` and `budgetId`.

Offline writes report `committed-local`. They record the engine's sync messages for later synchronization. For a cached sync budget, the next online command refreshes before returning data. `--offline` cannot be combined with `--refresh`, `--no-cache`, or an actual synchronization request. Offline reads report unknown freshness. Local budget creation and publication remain future work.

### Environment Variables

| Variable                     | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `ACTUAL_SERVER_URL`          | URL of the Actual sync server (required)              |
| `ACTUAL_PASSWORD`            | Server password (required unless using token)         |
| `ACTUAL_SESSION_TOKEN`       | Session token (alternative to password)               |
| `ACTUAL_SYNC_ID`             | Budget Sync ID (required for most commands)           |
| `ACTUAL_DATA_DIR`            | Local directory for cached budget data                |
| `ACTUAL_CACHE_TTL`           | Cache TTL in seconds (default: 60)                    |
| `ACTUAL_LOCK_TIMEOUT`        | Budget-dir lock wait timeout in seconds (default: 10) |
| `ACTUAL_NO_LOCK`             | Set to `1` to disable budget-dir locking              |
| `ACTUAL_ENCRYPTION_PASSWORD` | Password for end-to-end encrypted budget files        |

The three secrets — `ACTUAL_PASSWORD`, `ACTUAL_SESSION_TOKEN` and `ACTUAL_ENCRYPTION_PASSWORD` — can be read from a file instead, by adding `_FILE` to the variable name (for example `ACTUAL_PASSWORD_FILE=/run/secrets/actual-password`). `_FILE`-suffixed environment variables take priority over regular ones.

### Config File

The CLI uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) for configuration. The config file can be anywhere between the current working directory and your home directory.

You can create a config file in any of these formats:

- `.actualrc` (JSON or YAML)
- `.actualrc.json`, `.actualrc.yaml`, `.actualrc.yml`
- `actual.config.json`, `actual.config.yaml`, `actual.config.yml`
- An `"actual"` key in your `package.json`

You can instead store your configuration in the `actual` subdirectory of the global configuration directory (e.g. `~/.config/actual/` on Linux) in any of these formats:

- `config` (JSON or YAML)
- `config.json`
- `config.yaml`
- `config.yml`

Example `.actualrc.json`:

```json
{
  "serverUrl": "http://localhost:5006",
  "password": "your-password",
  "syncId": "1cfdbb80-6274-49bf-b0c2-737235a4c81f",
  "cacheTtl": 60,
  "lockTimeout": 10,
  "noLock": false
}
```

**Security:** Avoid storing plaintext passwords in config files (including the `password` key above). If these files do contain passwords, set restrictive permissions (e.g. 600 on Linux), and, if they are in a git repo, add them to `.gitignore`. Prefer environment variables such as `ACTUAL_PASSWORD` or `ACTUAL_SESSION_TOKEN`, or use a session token in config instead of a password. Better still, use your runtime's built-in support for secrets (e.g. Docker secrets) and point `ACTUAL_PASSWORD_FILE` or `ACTUAL_SESSION_TOKEN_FILE` at the resulting file. See [Environment Variables](#environment-variables) for details.

### Global Flags

| Flag                      | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `--server-url <url>`      | Server URL                                      |
| `--password <pw>`         | Server password                                 |
| `--session-token <token>` | Session token                                   |
| `--sync-id <id>`          | Budget Sync ID                                  |
| `--data-dir <path>`       | Data directory                                  |
| `--cache-ttl <seconds>`   | Cache TTL; `0` disables caching (default: 60)   |
| `--refresh`               | Force a sync on this call, ignoring the cache   |
| `--no-cache`              | Alias for `--refresh`                           |
| `--lock-timeout <secs>`   | Lock wait timeout (default: 10)                 |
| `--no-lock`               | Disable budget-dir locking (use with care)      |
| `--format <format>`       | Output format: `json` (default), `table`, `csv` |
| `--verbose`               | Show informational messages                     |

## Commands

| Command           | Description                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `accounts`        | Manage accounts                                                        |
| `account-groups`  | Manage account groups                                                  |
| `budgets`         | Manage budgets, allocations, moves, templates and reservations         |
| `categories`      | Manage categories                                                      |
| `category-groups` | Manage category groups                                                 |
| `transactions`    | Manage transactions                                                    |
| `payees`          | Manage payees                                                          |
| `tags`            | Manage tags                                                            |
| `notes`           | Read and change notes                                                  |
| `preferences`     | Inspect and change preferences                                         |
| `cash-planning`   | Inspect and save cash plans                                            |
| `transfers`       | Review, match and repair transfers                                     |
| `imports`         | Inspect, preview and import files; saved mappings and import history   |
| `rules`           | Manage transaction rules                                               |
| `reconcile`       | Reconcile an account against a statement; finish; adjust               |
| `reports`         | Cash flow, category and net worth reports; CSV/HTML export             |
| `checkup`         | Data-quality findings, month coverage and statement evidence           |
| `bank-sync`       | Bank sync status, refresh of linked accounts and run results           |
| `workflow`        | Setup, intake, weekly checkup, monthly close, goal review; run records |
| `schedules`       | Manage schedules; list upcoming occurrences; post or skip the next     |
| `query`           | Run an ActualQL query                                                  |
| `server`          | Server utilities and lookups                                           |
| `sync`            | Refresh or inspect local cache                                         |

Run `actual <command> --help` for subcommands and options.

### Examples

```bash
# List all accounts (as a table; excludes closed by default)
actual accounts list [--include-closed] --format table

# Find an entity ID by name
actual server get-id --type accounts --name "Checking"

# Add a transaction (amount in integer cents: -2500 = -$25.00)
actual transactions add --account <id> \
  --data '[{"date":"2026-03-14","amount":-2500,"payee_name":"Coffee Shop"}]'

# Export transactions to CSV
actual transactions list --account <id> \
  --start 2026-01-01 --end 2026-12-31 --format csv > transactions.csv

# Set budget amount ($500 = 50000 cents)
actual budgets set-amount --month 2026-03 --category <id> --amount 50000

# Run an ActualQL query
actual query run --table transactions \
  --select "date,amount,payee" --filter '{"amount":{"$lt":0}}' --limit 10

# Find an entity by name (reports ambiguous matches)
actual query resolve payees "grocery"

# Split-aware totals by category for a month
actual query aggregate --start 2026-08-01 --end 2026-08-31
```

### Amount Convention

All monetary amounts are **integer cents** when passed as input (flags, JSON):

| CLI Value | Dollar Amount |
| --------- | ------------- |
| `5000`    | $50.00        |
| `-12350`  | -$123.50      |

**Output formatting:** Table (`--format table`) and CSV (`--format csv`) output automatically converts cent values to decimal (e.g. `1665.00` instead of `166500`). JSON output always returns raw cents for programmatic use.

### Tips & Common Pitfalls

- **Split transactions:** When summing or counting transactions, filter `"is_parent": false` to avoid double-counting. A split parent holds the total amount, and its children hold the individual parts — including both would count the total twice.

- **Rapid sequential requests:** The CLI caches the budget locally (see [Caching](#caching)), so read-heavy scripts no longer need a single-query workaround by default. For very chatty scripts, run `actual sync` once and then use a long `--cache-ttl` for reads:

  ```bash
  actual sync
  actual --cache-ttl 3600 query run ...
  actual --cache-ttl 3600 accounts list
  ```

- **Uncategorized transactions:** `category.name` is `null` for transactions without a category. Account for this when filtering or grouping by category.

- **No date sub-fields in AQL:** `date.month`, `date.year`, etc. are not supported as query fields. To group by month, fetch raw transactions with a date range filter and aggregate locally in a script.

## Caching

The CLI keeps a local copy of your budget so repeated commands don't hit the sync server on every call. Within the TTL (default `60` seconds), read commands (`list`, `balance`, `query run`, …) reuse the cached budget without a network round-trip. Write commands (`add`, `update`, `set-amount`, …) always sync with the server before and after the write.

- `actual sync` — refresh the cache now.
- `actual sync --status` — show how stale the local cache is.
- `actual sync --clear` — delete the local cache; the next command re-downloads.
- `--refresh` (or `--no-cache`) — force a sync on a single call.

`actual --offline sync status` inspects engine messages beyond the last synchronization checkpoint without contacting the server. It reports `pendingMessages`, received `deferredMessages` requiring a newer schema, and the selected identities. Remote freshness remains unknown offline. Repeated status reads do not send or replay writes.

`actual sync refresh` synchronizes existing writes and returns the engine checkpoint and pending counts. After a failed push, use this command instead of repeating the mutation. Failed pushes invalidate cache freshness and report a local commit. `--require-fresh` requires successful synchronization before a remote read, even within the cache TTL. It rejects offline mode and fails if the server is unavailable. These commands use version 2 output.

`actual sync watch --interval 5 --timeout 30 --samples 100 --retries 5` observes the selected remote budget. Each attempt uses a separate engine process with a deadline. Retries use exponential backoff capped at 30 seconds. The retry limit counts consecutive failed attempts. The sample limit bounds successful observations and result size. Watch never repeats a budget mutation. Credentials travel to the worker over stdin rather than command arguments.

Watch prints progress events to stderr and one version 2 result when it finishes. Cancel with Ctrl+C or send a line containing `cancel` to stdin. The result reports cancellation, reconnects, and observed engine states. A timeout ends its worker; dead reader markers are removed when the next writer acquires the cache. Watch checks that the selected sync identity remains stable. Local locks do not serialize other remote clients.

- `--cache-ttl <seconds>` — override the TTL for a single call (use `0` to disable caching).

### Concurrency

The CLI takes a shared lock for reads and an exclusive lock for writes on the per-budget cache directory. Many parallel reads are safe; writes serialize. If another CLI process is holding the lock, subsequent invocations wait up to `--lock-timeout` seconds (default `10`) before failing with an error. Pass `--no-lock` to opt out in trusted single-process setups.

## Running Locally (Development)

### Create a local budget through the CLI

```bash
actual --offline --data-dir ./actual-data budgets create --name "My finances" --currency USD --operation-id create-finances
actual --offline --data-dir ./actual-data --budget-id <returned-id> --output-version 2 accounts create --name Checking --balance 10000 --operation-id create-checking
actual --offline --data-dir ./actual-data --budget-id <returned-id> --output-version 2 accounts list
```

Creation returns a stable local ID and uses version 2 JSON by default. It retains Actual's default categories. Currency is optional and must use an uppercase three-letter code. The CLI creates the data directory when needed. Duplicate names are rejected. Use the returned ID for subsequent commands.

Creation never publishes a budget, even when your profile contains server credentials. The initial creation command requires explicit offline mode. Creation does not select or change a saved profile. The public API also provides `createBudget({ name, currency })` after initialization; it creates and loads a local budget without uploading it.

Inspect a selected budget, save an explicit local selection, or create an isolated copy:

```bash
actual --offline --data-dir ./actual-data --budget-id <id> budgets inspect
actual --data-dir ./actual-data budgets select <id> --save-profile personal
actual --profile personal --output-version 2 accounts list
actual --profile personal budgets clone --name "Planning copy" --operation-id clone-planning
```

`budgets select` validates the local ID before updating the named profile. It saves offline mode and the data directory, selects that profile, and retains its secret file references. Command-line and environment settings still override profile settings. Budget names never act as selectors.

`budgets clone` requires offline mode and uses the engine's duplication operation. It closes the source before copying SQLite, preserves accounts, transactions, and preferences, and assigns a new local ID and synchronization clock. The copy has no cloud file ID, sync ID, or encryption key identity. Cloning never publishes or changes a saved profile. Use its returned ID to inspect or edit the copy. To clone a remote budget, download it first, then use its offline cache.

The public API provides `inspectBudget()` and `cloneBudget({ name })` for the loaded budget. Initialize without a server before cloning.

### Publish, rename, and archive

```bash
actual --profile personal --server-url http://localhost:5006 budgets publish <local-id> --operation-id publish-personal
actual --offline --budget-id <local-id> budgets rename --name "Personal finances" --operation-id rename-personal
actual --offline --budget-id <local-id> budgets archive --operation-id archive-personal
actual --offline --budget-id <local-id> budgets archive --restore --operation-id restore-personal
```

Publication uses the explicit local ID argument. It authenticates using configured credentials, including secret file references. It ignores an inherited offline profile or budget selector for this operation. Do not pass `--offline`, `--budget-id`, or `--sync-id` to publication. The result returns the new sync ID and cloud file ID. Later online commands select that sync ID.

Set `ACTUAL_ENCRYPTION_PASSWORD_FILE` or a profile's `encryptionPasswordFile` to encrypt the first upload. The server must advertise `encrypted-initial-publication` in `/health`. Older servers require an upgrade for this operation. The first request contains encrypted budget bytes and registers the key salt and encrypted test content. Publication never uploads a plaintext snapshot before enabling encryption. Without an encryption password, publication creates an unencrypted budget.

Publication retains its server, encryption mode, and file ID in budget metadata before uploading. A lost response reports `PARTIAL_COMPLETION`. Inspect the budget, then retry publication with the same server and encryption mode. The CLI inspects the retained remote identity before uploading, so an accepted upload is recovered rather than duplicated. A previously published file that is missing from the server is not recreated silently. An acknowledged operation ID returns its retained receipt and remote identity without uploading again. Use sync commands for subsequent ledger synchronization. Publication never changes a saved profile.

Rename uses Actual's synced budget-name writer and retains all identities. Archive requires offline mode and sets a reversible device-local marker. It retains the local data, leaves the budget inspectable, and marks it in `budgets list`. It does not delete or archive a remote file. Exported budgets and clones omit the local archive marker and publication state.

The public API provides `publishBudget(id, { encryptionPassword })`, `renameBudget(name)`, and `archiveBudget(archived = true)`. Initialize with a server for publication. Initialize without a server to operate offline. These foundation commands do not yet provide preview tokens or mutation receipts; task 0014 adds that protocol.

Managed lifecycle requires a sync-server build that includes the managed instance identifier in `/health`. Stop the managed server before upgrading its executable.

`actual --offline backups create --directory ./backups` exports the selected local budget into a uniquely named `.actualbackup` directory. The directory contains `budget.zip` and a version 1 `manifest.json`. The manifest records source identities, currency, creation time, checkpoint, pending messages, archive size, and SHA-256. Files are flushed and checked before the staging directory becomes the completed artifact. Existing backups are retained.

The exported archive is plaintext, including when its source uses encrypted remote synchronization. The manifest distinguishes source encryption from artifact encryption. Offline freshness remains unknown. Creation verifies file completion and hash.

`actual backups list --directory ./backups --limit 100` lists manifests without connecting to a server. Results disclose truncation. A `not-validated` status means the manifest was readable; listing does not import or hash the archive.

`actual backups validate ./backups/<artifact>.actualbackup --timeout 60` checks the manifest, archive size, SHA-256, and source identity. It imports the archive through the public API into a private temporary directory without server credentials. It reads domain tables and account balances, then removes the directory. Results include row counts and hashes for comparison. Validation does not modify the source or existing backup. It rejects symbolic links. Cancel with Ctrl+C or a `cancel` line on stdin; cleanup waits for the worker to close.

`actual --offline backups restore ./backups/<artifact>.actualbackup --name "Restored copy"` validates the artifact before creating a new local budget. The engine generates a new ID and clears remote, encryption, and publication metadata. The name must be unique. The command returns the new ID, domain snapshot, and `published: false`. It preserves the source budget and backup. Validation can be cancelled; after the restore starts writing, it finishes or cleans up before returning. An incomplete cleanup or a failed final inspection returns partial completion; inspect the reported data directory or budget ID before retrying.

Use `actual --offline budgets compare <left-id> <right-id> --limit 100 --timeout 60` to compare two explicit local budgets. The command exports each budget and reads it in an isolated worker. Results contain domain table fingerprints and account balance differences by stable ID. The budgets are observed separately; the result does not represent one simultaneous snapshot. Remote freshness is unknown. Balance deltas are unavailable when currencies differ or an account is missing. Results disclose truncation.

Use `actual backups prune --directory ./backups --keep 1 --limit 100 --timeout 60` to inspect retention candidates. Add `--apply` to delete older valid artifacts. The command keeps at least the requested number of newest valid backups for each source ID. It preserves corrupt artifacts, symbolic links, and directories containing extra files. A truncated inventory prevents deletion. Creation and retention share a lock on the backup directory. Apply imports every eligible archive and rechecks its manifest and hash before deletion. Each invocation computes a fresh policy; the inspection is not a reusable preview token. The timeout covers the retention operation. Partial completion identifies completed deletions and the active artifact; inspect those paths before retrying.

Run the disposable integration suite after type checking and rebuilding the packages:

```bash
yarn typecheck
yarn exec lage build --scope=@actual-app/cli --no-cache
yarn workspace @actual-app/sync-server build
yarn workspace @actual-app/cli test:integration
```

The harness creates a temporary server, budgets, credentials, and two client caches. It removes them after each test. Type checking emits files into some build directories, so rebuild before running packaged integration tests. Linux execution remains to be verified; this implementation was tested on Windows.

If you're working on the CLI within the monorepo:

```bash
# 1. Build the CLI
yarn build:cli

# 2. Start a local sync server (in a separate terminal)
yarn start:server-dev

# 3. Open http://localhost:5006 in your browser, create a budget,
#    then find the Sync ID in Settings → Advanced → Sync ID

# 4. Run the CLI directly from the build output
ACTUAL_SERVER_URL=http://localhost:5006 \
ACTUAL_PASSWORD=your-password \
ACTUAL_SYNC_ID=your-sync-id \
node packages/cli/dist/cli.js accounts list

# Or use a shorthand alias for convenience
alias actual-dev="node $(pwd)/packages/cli/dist/cli.js"
actual-dev budgets list
```

### Guarded changes (initial checkpoints)

Use `actual changes preview transactions.update <id> --operation-id <unique-id> --data '{"notes":"Updated","amount":-1234}'` to prepare a device-local proposal. This checkpoint supports notes, amount, date, and cleared on ordinary, split, and reciprocally linked transfer transactions. Split previews capture every parent and child row; the engine applies inheritance and recalculates split errors. Select the split parent to change inherited date and cleared values. A sibling edit makes the proposal stale. Linked transfer previews also capture the counterpart and its split, when present. Apply mirrors the canonical amount, notes, and schedule while preserving the counterpart date and cleared flag. Account references determine category clearing. Broken links require a separate repair operation. Budget creation, clone, restore, rename, and local archive use this receipt protocol. Publish and the remaining direct mutation adapters remain under implementation.

Preview returns before/after values, budget identities, reference preconditions, side effects, and a token. It refreshes online state and writes only its disclosed local receipt. Use `actual changes apply <operation-id> --token <token>` to apply. Apply refreshes online state and checks the observed proposal inside the engine mutation boundary. Offline apply checks local state and reports unknown remote freshness. The local lock cannot exclude remote edits arriving after refresh. --no-lock is rejected for these commands.

Receipts move from prepared to uncertain before the engine call. An acknowledged outcome becomes committed-local, then synced after successful synchronization. Unknown engine outcomes remain uncertain and never automatically replay. Repeating a committed operation retries synchronization without executing the mutation again. A rejected proposal becomes failed-before-commit; prepare a new operation ID after inspecting the changed state. Use `actual changes status <operation-id>` and `actual changes list --limit 100` to inspect receipts without synchronizing or replaying.

Receipts reside in `<data-dir>/.actual-cli/changes`. They contain sensitive before/after records but no credentials. The journal retains up to 500 records and removes terminal synced/failed records and acknowledged local-only creation/clone/restore/archive records older than 30 days, or the oldest terminal entries when capacity is needed. Prepared, uncertain, and committed receipts that still require synchronization are preserved. If unresolved entries fill the journal, preparation fails before mutation. Files use private creation permissions where the platform supports them. Status inspection does not prove causation from matching ledger values. Real browser stale-edit and three process-interruption tests cover this transaction checkpoint on Windows. General version 2 mutation adapters remain required before task 0014 is complete.

After forced process termination, the existing cache and journal locks can remain until their approximately 30-second stale window expires. Use `--lock-timeout 45` when inspecting the interrupted operation. An uncertain receipt stays uncertain even when current values resemble the proposal. Inspect the receipt and selected budget before preparing further work; the same ID never automatically replays.

Use `actual changes preview budgets.set-amount <category-id> --operation-id <unique-id> --data '{"month":"2026-08","amount":31234}'` to prepare an allocation amount change. Amounts use integer cents. The proposal records the existing allocation row and the selected engine budget mode, category, and group. Apply rejects changed allocation or reference state and preserves carryover, goals, and settings through the canonical amount setter. A zero no-op on a missing row does not create a new allocation record. The same apply/status/list and receipt rules cover this operation. The CLI does not calculate projected budget totals itself.

For direct version 2 writes, use `actual --output-version 2 budgets set-amount --month 2026-08 --category <category-id> --amount 31234 --operation-id <unique-id>`. The command uses the same preview and receipt executor and returns `success` plus `receipt`. Keep the operation ID and request unchanged on retries. A retry returns the acknowledged outcome without resetting a later allocation. Reusing an ID for a different amount, month, category, or budget rejects. Offline writes retain a local acknowledgement until synchronization. Legacy output keeps its existing command behavior.

When a journal opens under its lock, it checks up to 500 `.pending` files. It removes only private staging copies whose operation ID and proposal fingerprint match a published receipt. The published state remains authoritative; a staged committed result never upgrades an uncertain receipt. Orphaned, malformed, linked, mismatched, or unmanaged staging files remain untouched. `changes list` reports their paths, reasons, count, and truncation under `staging`. These files block new proposals and uncertain apply intent before an engine write. Inspect and preserve any needed evidence before resolving the reported local files. Existing acknowledged receipts can still record synchronization outcomes. Unknown staging files are never deleted recursively or used as proof of budget commit.

Budget rename and archive require `--operation-id <unique-id>`. Their version 2 results include the existing budget inspection fields and a receipt. While its receipt is retained, repeating an acknowledged operation ID returns its original outcome without repeating the write. A different request needs a new operation ID. These operations reject `--no-lock`.

Use `actual changes preview budgets.rename <local-id> --operation-id <unique-id> --data '{"name":"Personal finances"}'` to preview a rename. Apply uses the same `actual changes apply <operation-id> --token <token>` command as transaction changes. The engine checks the selected budget identity, current name, archive marker, and name availability before applying.

Use `actual --offline --budget-id <local-id> changes preview budgets.archive <local-id> --operation-id <unique-id> --data '{"archived":true}'` to preview a local archive. Select the same budget with `--budget-id <local-id>` when preparing and applying. Archive and archive restoration require offline mode. They change only the local archive marker and preserve the remote budget. Their receipts declare `delivery: "local-only"` and remain `committed-local` after acknowledgement. An uncertain archive receipt never automatically replays.

Local budget creation requires `--operation-id <unique-id>`. Use `actual --offline --data-dir ./actual-data changes preview budgets.create --operation-id create-finances --data '{"name":"My finances","currency":"USD"}'` to prepare creation without a target ID. Preview checks name availability and preserves the budget inventory. It does not reserve the name or create a destination.

Use `actual --offline --data-dir ./actual-data changes apply create-finances --token <token>` to apply. The receipt declares `budget: null` before creation and returns the actual new ID in `outcome.affectedIds` after acknowledgement. Its delivery is local-only, so it remains `committed-local`. Direct `budgets create` returns the new budget inspection and this receipt. While the receipt is retained, retries return the same destination without creating another budget. An occupied name makes an uncommitted preview stale. Unknown outcomes remain uncertain; a similarly named budget cannot prove which operation created it. Publication is a separate operation.

Local cloning requires `--operation-id <unique-id>` and offline mode. Use `actual --offline --budget-id <source-id> changes preview budgets.clone <source-id> --operation-id clone-planning --data '{"name":"Planning copy"}'` to prepare a copy. Preview preserves the source and inventory. Its fingerprint covers persistent source tables, schema, and copied metadata. It excludes the engine cache and synchronization clock that the new copy recomputes or resets. A source edit or occupied destination name rejects an uncommitted preview.

Apply with `actual --offline --budget-id <source-id> changes apply clone-planning --token <token>`. The local-only receipt acknowledges the actual destination ID in `outcome.affectedIds` and remains `committed-local`. Direct `budgets clone` returns inspection fields, `sourceBudgetId`, and the receipt. While the receipt is retained, retries return the original destination even if the source later changes. Uncertain outcomes never automatically replay. The copy has a separate identity and never publishes itself.

Guarded restore uses `actual --offline changes preview backups.restore --operation-id <unique-id> --data '{"path":"<artifact>.actualbackup","name":"Restored copy"}'`. Restore has no existing target ID. Preview validates the backup in an isolated worker and binds its exact hash and byte count. The receipt includes an absolute artifact path and validation deadline; archive bytes stay outside the journal. Apply rechecks and validates the artifact before writing. Missing or changed input fails before commit. The engine creates a new local identity and clears remote publication state. Direct `backups restore` requires `--operation-id` in version 2 and uses the same receipt executor. Retained acknowledged retries return the original destination even if the archive was later removed. Uncertain restores never replay automatically. Restore requires offline mode and local locks. Acknowledged local-only restore receipts follow the same 30-day/capacity policy.

Guarded publication uses `actual changes preview budgets.publish <local-id> --operation-id <unique-id> --data '{"encrypted":true}'`. Preview binds the source hash, exact server and encryption mode. Supply encryption credentials through the normal secret options when applying. Credentials stay outside proposals and receipts. Direct version 2 publication requires `--operation-id` and uses the same executor. Retry the same ID after partial completion. Recovery only acknowledges authenticated remote acceptance of the retained identity; remote absence remains uncertain without another initial upload. Exact request/server/mode collisions reject. Publication retains source and lifecycle locks through shutdown. Acknowledged synchronized publication receipts follow the 30-day/capacity policy; uncertain or unacknowledged receipts remain retained.

Guarded carryover uses `actual changes preview budgets.set-carryover <category-id> --operation-id <unique-id> --data '{"month":"2026-08","flag":false}'`. Version 2 direct `budgets set-carryover` also requires `--operation-id`. Its proposal records every month in the engine range from the selected month onward, with existing rows, carryover flags, category, group and budget mode. The engine rejects changed months, rows or references before applying. It preserves allocation amounts and uses the existing carryover writer, including creation of missing allocation rows. The direct command returns `success` plus `receipt`. Reuse the same ID and request for retries. An acknowledged retry preserves a later carryover change. Legacy output retains its existing behavior.

Guarded holds use `actual changes preview budgets.hold-next-month --operation-id <unique-id> --data '{"month":"2026-08","amount":12345}'`. Reset uses `actual changes preview budgets.reset-hold --operation-id <unique-id> --data '{"month":"2026-08"}'`. Omit the entity ID argument. Version 2 direct `budgets hold-next-month` and `budgets reset-hold` require `--operation-id` and return `success` plus `receipt`. The preview records the existing month row, engine available funds, budget mode, persistent source fingerprint and resulting buffered amount. The engine clamps a hold to available funds and leaves it unchanged when funds are unavailable. Reset creates a missing month row when needed. Apply rejects a changed source or calculation before writing. Acknowledged retries preserve later hold/reset changes. Legacy output retains its existing behavior.

Guarded account creation uses `actual changes preview accounts.create --operation-id <unique-id> --data '{"name":"Checking","offbudget":false,"initialBalance":10000}'`. Select an existing budget and omit the entity ID argument. Preview preserves the budget and records account fields, transfer payee creation, and the opening transaction date, amount, and references. It does not create a missing Starting Balance payee.

Direct version 2 `accounts create` requires `--operation-id` and returns `id` plus `receipt`. The acknowledged outcome reports actual account, transfer payee, opening transaction, and Starting Balance payee IDs. A zero balance creates no opening transaction. Reuse the same ID and request for retries. An acknowledged retry returns the original ID and preserves later edits. Uncertain creation never replays automatically; matching names cannot establish its outcome. Legacy output retains its existing behavior. Synced receipts can expire only with complete acknowledged identities. Uncertain and incomplete receipts remain retained.

Guarded account updates use `actual changes preview accounts.update <account-id> --operation-id <unique-id> --data '{"name":"Checking","offbudget":false}'`. Preview preserves records and shows account fields and derived transfer payee names. The shared payload also supports `closed`, nullable integer `balance_current`, and nullable `account_group_id`. A non-null group must exist. Stored bank balance differs from computed ledger balance. Changing `closed` through this update only changes the field; it does not unlink a bank or transfer a balance.

Direct version 2 `accounts update` requires `--operation-id` and retains its `--name` and `--offbudget` options. It returns `success`, `id`, and `receipt`. Apply rejects changed account, ledger, or group references before using the existing writer. Renaming changes displayed transfer payee names without payee writes. Retried acknowledged updates preserve later account edits. Uncertain updates never replay automatically. Legacy output retains its existing behavior.

Guarded account reopening uses `actual changes preview accounts.reopen <account-id> --operation-id <unique-id> --data '{}'`. Supply an empty payload object. Preview shows the account becoming visible and preserves its ledger and provider fields. Apply rejects changed account, ledger, or references before invoking the existing reopening writer. Reopening does not relink a bank or transfer a balance.

Direct version 2 `accounts reopen` requires `--operation-id` and returns `success`, `id`, and `receipt`. An already-open account acknowledges `changed: false`. Retried acknowledged reopening preserves a later closure. Uncertain reopening never replays automatically. Legacy output retains its existing behavior.

Guarded account deletion uses `actual changes preview accounts.delete <account-id> --operation-id <unique-id> --data '{}'`. Preview binds the complete ledger, split rows, transfer counterparts, transfer payee and provider references. Apply rejects stale or tampered consequences before writing. Deletion clears reciprocal transfer/payee references while preserving counterpart amounts. Empty accounts are deleted. The existing already-closed account behavior only unlinks provider fields and preserves the account and ledger.

Direct version 2 `accounts delete` requires `--operation-id` and returns `success`, `id`, `providerRemovalStatus` and `receipt`. Receipts retain actual deleted/updated identities and prevent acknowledged retries from repeating deletion. Unknown engine outcomes never replay. `synced` describes budget synchronization; provider removal can remain `uncertain`, `skipped-no-token` or `skipped-other-accounts`. A provider response failure never establishes remote removal. Receipts with uncertain provider removal do not expire through normal retention. Legacy output remains unchanged.

Guarded account closure uses `actual changes preview accounts.close <account-id> --operation-id <unique-id> --data '{"transferAccount":"destination-id","transferCategory":"category-id"}'`. Both payload fields are optional. A nonzero balance requires a transfer account. Preview binds the closing date and source identity, evaluates counterpart rules through the core engine, and captures ledger, rule, schedule and provider state. Apply rejects stale consequences before writing. Empty accounts are deleted; zero-balance accounts with transactions are closed; already-closed accounts retain their ledger after provider unlink.

Direct version 2 `accounts close` requires `--operation-id`. Existing `--transfer-account` and `--transfer-category` options retain their meaning. The result includes `success`, `id`, `providerRemovalStatus` and `receipt`. Receipts identify the actual closing source and counterpart and prevent acknowledged retries from repeating closure. Unknown outcomes never replay. Budget synchronization and provider removal have separate outcomes; uncertain or incomplete provider acknowledgements remain retained. Legacy output remains unchanged.

Guarded category updates use `actual changes preview categories.update <category-id> --operation-id <unique-id> --data '{"name":"Groceries","hidden":false,"group_id":"group-id","is_income":false}'`. Each field is optional, but the payload must contain at least one supported field. An optional `id` must match the target. Preview preserves ledger rows, allocations, templates and mappings. Apply rejects changed category/group/source references and verifies the actual category row after the canonical update.

Direct version 2 `categories update` requires `--operation-id` and returns `success`, `id` and `receipt`. Its existing name and hidden options retain their meaning. Acknowledged retries preserve later edits rather than repeating the old update. Unknown outcomes never replay. Legacy output remains unchanged.

Guarded category creation uses `actual changes preview categories.create --operation-id <unique-id> --data '{"name":"Groceries","group_id":"group-id","is_income":false,"hidden":false}'`. Omit the target ID argument. Name and group ID are required; both flags default to false. Preview binds the destination group, canonical sibling ordering and source state without creating rows. Apply creates the category and self mapping through the core owner and returns their actual IDs plus reordered sibling IDs.

Guarded payee creation uses `actual changes preview payees.create --operation-id <unique-id> --data '{"name":"Corner Grocer"}'`. Omit the target ID argument. The name keeps its exact spelling, and duplicate or empty names follow the existing API behavior. A supplied `transfer_acct` retains the existing ignored creation semantics and never creates a transfer payee. Preview binds the full source state without writing. Apply creates the payee and its self mapping through the core owner and returns their actual generated IDs. Direct version 2 `payees create` requires `--operation-id` and returns `id` and `receipt`. Acknowledged retries do not recreate the payee; unknown outcomes never replay; receipts without a complete payee and mapping acknowledgement remain retained. Legacy output remains `{ id }`.

Guarded payee updates use `actual changes preview payees.update <payee-id> --operation-id <unique-id> --data '{"name":"New name"}'`; only a non-empty name is accepted, and transfer, missing or deleted payees are rejected. Guarded payee deletion uses `changes preview payees.delete <payee-id> --data '{}'`; transfer payees stay unchanged and the preview says so. Guarded merges use `changes preview payees.merge <target-id> --data '{"mergeIds":["id-1","id-2"]}'`; sources must be unique, live and exclude the target, transfer sources are skipped and listed, and the preview lists every mapping that will point at the target. Guarded tags use `tags.create` (payload `{"tag":"name","color":null,"description":null}`, no target ID), `tags.update <tag-id>` (any of `tag`, `color`, `description`) and `tags.delete <tag-id> --data '{}'`. Tag names cannot contain whitespace or `#`; creating a name held by a live tag is rejected, while a deleted tag with that name is revived. Tag changes never rewrite transaction notes. Direct version 2 `payees update|delete|merge` and `tags create|update|delete` require `--operation-id` and return a receipt; `tags create` also returns the actual tag `id`. Legacy outputs are unchanged. Guarded rules use `changes preview rules.create --data '<rule>'` (all of `stage`, `conditionsOp`, `conditions`, `actions`; no target ID), `rules.update <rule-id> --data '<fields>'` (any subset, merged over the stored rule) and `rules.delete <rule-id> --data '{}'`. Rules are validated like the legacy API, rules that belong to a schedule cannot be edited or deleted this way, and existing transactions are never re-run. Direct version 2 `rules create|update|delete` require `--operation-id`; `rules create` returns the actual rule `id`. Guarded schedules use `changes preview schedules.create --data '<schedule>'` (explicit live `payee` and `account`, `posts_transaction`, `amountOp`, `date`; no target ID), `schedules.update <schedule-id> --data '{"fields":{...},"resetNextDate":false}'` and `schedules.delete <schedule-id> --data '{}'`. The preview binds the exact linked rule conditions and actions; the next date is recomputed by the owner at apply. Direct version 2 `schedules create|update|delete` require `--operation-id`; `schedules create` returns the actual schedule `id`. Guarded transaction deletion uses `changes preview transactions.delete <transaction-id> --data '{}'`; it deletes a top-level transaction or a whole split (never a single split child), and the preview lists every transfer counterpart that will be deleted or unlinked. Direct version 2 `transactions delete` requires `--operation-id`. Guarded `transactions.update` also accepts `category` (live category or null) and `payee` (live non-transfer payee); edits that would link or unlink a transfer, or set a category on a split parent, transfer or off-budget row, are rejected.

Guarded transaction additions use `actual changes preview transactions.add <account-id> --operation-id <unique-id> --data '[{"date":"2026-10-01","amount":-1250}]'`. The account must be live and open. Preview shows the planned rows after rules and split expansion; transfers are not run and categories are not learned. Guarded imports use `changes preview transactions.import <account-id>` with the same array payload; preview lists matched updates and new rows, and apply verifies the committed result against that plan. Direct version 2 `transactions add` and `transactions import` use the guarded path only when `--operation-id` is supplied and then return the acknowledged ids and `receipt`; without it they keep their existing behavior.

Direct version 2 `categories create` requires `--operation-id` and returns `id` and `receipt`. Acknowledged retries preserve later category edits and do not create another category. Unknown creation outcomes never replay. Receipts with missing or incomplete generated identities remain retained. Legacy output remains `{ id }`.

Guarded category deletion uses `previewCategoryDeletion({ id, transferCategoryId })` and `applyCategoryDeletion(proposal)`. The optional destination must be a different live category of the same income type. Preview preserves rows and declares canonical tombstone, forwarding mappings and expense allocation transfers for every created month. Apply checks budget identity and source state before writing and verifies the actual owner effects. Income deletion preserves the existing allocation behavior.

Use `actual changes preview categories.delete <category-id> --operation-id <unique-id> --data '{"transferCategoryId":"destination-id"}'`. Omit the destination with `--data '{}'`. Direct version 2 `categories delete <id> --transfer-to <destination-id> --operation-id <unique-id>` returns `success`, `id` and `receipt`. Acknowledged retries preserve later destination edits and allocations; unknown outcomes never replay. Legacy output remains `{ success: true, id }`.

Guarded group creation uses `actual changes preview category-groups.create --operation-id <unique-id> --data '{"name":"Income","is_income":true,"hidden":false}'`. Omit the target ID. Flags default to false, and names keep their exact spelling. Creation adds one group; supplied `categories` retain the existing API behavior and do not create child categories. Preview preserves budget data and binds canonical global ordering and source state. Apply returns the actual generated group ID. Direct version 2 `category-groups create` requires `--operation-id` and returns `id` and `receipt`. Acknowledged retries preserve later edits and do not recreate the group. Unknown outcomes never replay. Missing or incomplete generated identities remain retained. Legacy output remains `{ id }`.

Guarded group updates use `actual changes preview category-groups.update <group-id> --operation-id <unique-id> --data '{"name":"Income","is_income":true,"hidden":false}'`. Supply at least one group field. An optional `id` must match the target. Nested `categories` are read metadata and never update child rows. The shared owner now accepts that declared metadata instead of attempting to store it in the group table. Names retain exact spelling, and omitted fields retain their values. Preview preserves data and binds the group, children and source state. Apply rejects stale or tampered proposals and verifies the actual group row. Direct version 2 `category-groups update` requires `--operation-id`; acknowledged retries preserve later edits, and uncertain outcomes never replay.

Guarded group deletion uses `actual changes preview category-groups.delete <group-id> --operation-id <unique-id> --data '{"transferCategoryId":"destination-category-id"}'`. The destination is optional. A destination must be a live category outside the deleted group. Preview preserves data and binds all children, forwarding mappings, live child allocations and source state. Apply tombstones the group and every child, including previously deleted children. With a destination, it forwards mappings and transfers live child allocations for every created month, for both income and expense groups. It preserves source allocations and raw transaction rows. Without a destination, it preserves mappings and allocations. Direct version 2 `category-groups delete` requires `--operation-id`; `--transfer-to` retains its existing meaning. Acknowledged retries preserve later destination edits and allocations, and unknown outcomes never replay.
