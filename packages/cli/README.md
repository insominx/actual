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

| Command           | Description                    |
| ----------------- | ------------------------------ |
| `accounts`        | Manage accounts                |
| `budgets`         | Manage budgets and allocations |
| `categories`      | Manage categories              |
| `category-groups` | Manage category groups         |
| `transactions`    | Manage transactions            |
| `payees`          | Manage payees                  |
| `tags`            | Manage tags                    |
| `rules`           | Manage transaction rules       |
| `schedules`       | Manage scheduled transactions  |
| `query`           | Run an ActualQL query          |
| `server`          | Server utilities and lookups   |
| `sync`            | Refresh or inspect local cache |

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
- `--cache-ttl <seconds>` — override the TTL for a single call (use `0` to disable caching).

### Concurrency

The CLI takes a shared lock for reads and an exclusive lock for writes on the per-budget cache directory. Many parallel reads are safe; writes serialize. If another CLI process is holding the lock, subsequent invocations wait up to `--lock-timeout` seconds (default `10`) before failing with an error. Pass `--no-lock` to opt out in trusted single-process setups.

## Running Locally (Development)

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
