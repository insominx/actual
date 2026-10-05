---
title: 'CLI'
---

# CLI Tool

The `@actual-app/cli` package provides a command-line interface for interacting with your Actual Budget data. It connects to your sync server and lets you query and modify budgets, accounts, transactions, categories, payees, rules, schedules, and more — all from the terminal.

:::note
This is different from the [Server CLI](../install/cli-tool.md) (`@actual-app/sync-server`), which is used to host and manage the Actual server itself.
:::

## Installation

Node.js v22 or higher is required.

```bash
npm install --save @actual-app/cli
```

Or install globally:

```bash
npm install --location=global @actual-app/cli
```

## Configuration

### Managed server lifecycle

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

The server package must be installed or built. Use `--server-entry` when it cannot be resolved. Managed services bind to loopback and use a private supervisor. Stop authenticates that supervisor and uses its original child handle; it never kills a PID from disk. Startup checks the port, executable hash, and instance-specific health. Stop the service before upgrading its executable.

Set `ACTUAL_PASSWORD_FILE` to a protected password file before bootstrap. Bootstrap refuses an initialized server and never exposes a session token. Connection tests need no budget. Doctor also validates a selected budget when configured. Lifecycle logs omit raw server output. These commands use version 2 JSON by default. A lost stop response returns exit code 6; inspect status before another action.

Windows lifecycle tests pass. Linux execution and headless budget creation remain pending. These commands do not install services or complete browser-dependent identity-provider authentication.

Online commands require a running Actual sync server. Explicit offline commands use an existing local budget or downloaded cache. Configuration accepts CLI flags, environment variables, device-local profiles, and existing config files, in that priority order.

### Agent operation

```bash
actual capabilities
actual schema transactions.import
actual --output-version 2 --refresh accounts list
actual profiles set personal --file profile.json
actual --profile personal --output-version 2 context
actual --profile personal --offline --output-version 2 accounts list
```

Discovery requires no credentials or budget. Existing commands retain their default output; `--output-version 2` returns one JSON document after completion. New discovery, context, and profile commands always use version 2. Context identifies the selected budget, currency, scale, connection mode, observed freshness, and local or synced commit status.

Version 2 uses exit codes 2 for invalid input, 3 for missing context, 4 for stale previews, 5 for engine failures, and 6 for partial completion. After a failed push, retry synchronization. For guarded publication, retry the same operation ID to inspect remote acceptance without repeating an uncertain initial upload. Guarded previews and receipts cover the operations documented below. Reversal remains unavailable.

Use `actual --offline sync status` to inspect pending engine messages without server access. The result separates messages beyond the last synchronization checkpoint from received deferred messages that require a newer schema. Offline remote freshness is unknown.

Use `actual sync refresh` to synchronize existing writes without repeating their mutations. Use `--require-fresh` on a remote read to require successful synchronization before returning data. This flag rejects offline mode and fails if the server is unavailable. Failed pushes invalidate cache freshness while retaining the local commit.

Use `actual sync watch --interval 5 --timeout 30 --samples 100 --retries 5` for bounded observation and reconnect. Each attempt runs in a worker with a deadline. Retries back off up to 30 seconds; the retry limit counts consecutive failures. Cancel with Ctrl+C or a `cancel` line on stdin. Progress goes to stderr; the final version 2 result includes observations, cancellation, and reconnect count. The CLI does not replay mutations. It checks budget identity and releases or recovers cache locks after workers end. Remote clients remain independent of local cache locks.

Use `actual --offline backups create --directory ./backups` to create a uniquely named backup artifact. It contains an Actual zip and a versioned manifest with source identity, currency, freshness, pending messages, byte count, and SHA-256. The CLI flushes and checks the files before publishing the completed directory. It retains existing backups.

Backups are plaintext even when the source budget uses encrypted synchronization. The manifest declares artifact encryption separately. Creation checks file completion and hash.

Use `actual backups list --directory ./backups --limit 100` for a bounded manifest inventory. Listing does not claim archive validation. Use `actual backups validate <artifact>.actualbackup --timeout 60` to check the hash and import the archive in an isolated offline worker. Validation checks domain queries, account balances, and the manifest's source identity. It returns row counts and hashes and removes its temporary budget after the worker closes. Symbolic links are rejected. Cancel with Ctrl+C or a `cancel` line on stdin.

Use `actual --offline backups restore <artifact>.actualbackup --name "Restored copy" --operation-id restore-copy` to create a new local budget after validation. The name must be unique. The result includes the new ID and domain snapshot. Restore clears remote, encryption, and publication metadata and never publishes the copy. It preserves the source and backup. Once writing starts, restore finishes or cleans up before returning. Partial completion reports incomplete cleanup or a failed final inspection; inspect the reported directory or budget ID before retrying.

Use `actual --offline budgets compare <left-id> <right-id> --limit 100 --timeout 60` to compare two explicit local budgets. The command exports each budget and reads it in an isolated worker. Results contain domain table fingerprints and account balance differences by stable ID. The budgets are observed separately; the result does not represent one simultaneous snapshot. Remote freshness is unknown. Balance deltas are unavailable when currencies differ or an account is missing. Results disclose truncation.

Use `actual backups prune --directory ./backups --keep 1 --limit 100 --timeout 60` to inspect retention candidates. Add `--apply` to delete older valid artifacts. The command keeps at least the requested number of newest valid backups for each source ID. It preserves corrupt artifacts, symbolic links, and directories containing extra files. A truncated inventory prevents deletion. Creation and retention share a lock on the backup directory. Apply imports every eligible archive and rechecks its manifest and hash before deletion. Each invocation computes a fresh policy; the inspection is not a reusable preview token. The timeout covers the retention operation. Partial completion identifies completed deletions and the active artifact; inspect those paths before retrying.

Profiles contain `serverUrl`, a `syncId` or local `budgetId`, `dataDir`, optional `offline`, and secret file references. Use `passwordFile`, `sessionTokenFile`, and `encryptionPasswordFile`; plaintext secrets are rejected. The store defaults to `~/.actual-cli/profiles.json`. Select it with `--profile` or `ACTUAL_PROFILE`, and override its path with `--profiles-file` or `ACTUAL_PROFILES_FILE`. `profiles use <name>` selects a default without changing the budget.

Offline access requires `--offline --budget-id <local-id>` or a previously cached sync ID. Explicit local and sync flags cannot be combined. Offline mode ignores server credentials and reports unknown freshness. Offline writes record sync messages and return `committed-local`; the next online access to that cached sync budget refreshes. Offline mode cannot request a server refresh. Local creation requires offline mode. Explicit publication selects a local ID and authenticates online.

See the repository's `packages/cli/README.md` for the full contract and disposable verification commands.

### Environment Variables

| Variable                     | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `ACTUAL_SERVER_URL`          | URL of the Actual sync server (required)              |
| `ACTUAL_SYNC_ID`             | Budget Sync ID (required for most commands)           |
| `ACTUAL_PASSWORD`            | Server password (one of password or token required)   |
| `ACTUAL_SESSION_TOKEN`       | Session token (alternative to password)               |
| `ACTUAL_DATA_DIR`            | Local directory for cached budget data                |
| `ACTUAL_CACHE_TTL`           | Cache TTL in seconds (default: 60)                    |
| `ACTUAL_LOCK_TIMEOUT`        | Budget-dir lock wait timeout in seconds (default: 10) |
| `ACTUAL_NO_LOCK`             | Set to `1` to disable budget-dir locking              |
| `ACTUAL_ENCRYPTION_PASSWORD` | Password for end-to-end encrypted budget files        |

The three secrets — `ACTUAL_PASSWORD`, `ACTUAL_SESSION_TOKEN` and `ACTUAL_ENCRYPTION_PASSWORD` — can be read from a file instead, by adding `_FILE` to the variable name (for example `ACTUAL_PASSWORD_FILE=/run/secrets/actual-password`). `_FILE`-suffixed environment variables take priority over regular ones.

### CLI Flags

Global flags override environment variables:

| Flag                      | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `--server-url <url>`      | Server URL                                      |
| `--password <pw>`         | Server password                                 |
| `--session-token <token>` | Session token                                   |
| `--sync-id <id>`          | Budget Sync ID                                  |
| `--data-dir <path>`       | Local data directory for cached budget data     |
| `--format <format>`       | Output format: `json` (default), `table`, `csv` |
| `--verbose`               | Show informational messages on stderr           |

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

:::caution Security
Avoid storing plaintext passwords in config files (including the `password` key above). If these files do contain passwords, set restrictive permissions (e.g. 600 on Linux), and, if they are in a git repo, add them to `.gitignore`. Prefer environment variables such as `ACTUAL_PASSWORD` or `ACTUAL_SESSION_TOKEN`, or use a session token in config instead of a password. Better still, use your runtime's built-in support for secrets (e.g. Docker secrets) and point `ACTUAL_PASSWORD_FILE` or `ACTUAL_SESSION_TOKEN_FILE` at the resulting file. See [Environment Variables](#environment-variables) for details.
:::

## Usage

```bash
actual <command> <subcommand> [options]
```

## Commands

### Accounts

```bash
# List all accounts (excludes closed by default)
actual accounts list [--include-closed]

# Create an account
actual accounts create --name "Checking" [--offbudget] [--balance 50000]

# Inspect balances: ledger, cleared, uncleared, reconciled and future activity,
# with on-budget/off-budget totals, account groups and duplicate names
actual accounts inspect [--cutoff 2026-01-31] [--include-closed]

# Update an account (use --account-group-id none to ungroup it)
actual accounts update <id> [--name "New Name"] [--offbudget true] [--account-group-id <id>]

# Close an account (with optional transfer)
actual accounts close <id> [--transfer-account <id>] [--transfer-category <id>]

# Reopen a closed account
actual accounts reopen <id>

# Delete an account
actual accounts delete <id>

# Get account balance
actual accounts balance <id> [--cutoff 2026-01-31]
```

`accounts inspect` is read-only. Balances mirror the engine's account leaf rows. The cutoff defaults to today; transactions dated after it are reported as `future` with a count and are excluded from `ledger`. Totals count open accounts only, so on-budget money and off-budget equity stay separate. Closed accounts are listed with `--include-closed` but never counted. `sameNameIds` lists other accounts with the same name; resolve names with `actual query resolve accounts <name>`, which reports ambiguous matches instead of guessing.

### Account Groups

```bash
# List account groups
actual account-groups list

# Create, rename or delete a group through guarded changes
actual account-groups create --name "Everyday" --operation-id <unique-id>
actual account-groups update <id> --name "Daily" --operation-id <unique-id>
actual account-groups delete <id> --operation-id <unique-id>
```

Account group writes always use the guarded change protocol and require `--operation-id`. Retrying a committed creation returns the same group. Deleting a group ungroups its member accounts; their balances and transactions are unchanged. Move an account with `actual accounts update <id> --account-group-id <group-id>`.

### Budgets

```bash
# List available budgets on the server
actual budgets list

# Download a budget by sync ID
actual budgets download <syncId> [--encryption-password <pw>]

# Sync the current budget
actual budgets sync

# List budget months
actual budgets months

# View a specific month
actual budgets month 2026-03

# Set a budget amount (in integer cents)
actual budgets set-amount --month 2026-03 --category <id> --amount 50000

# Set carryover flag
actual budgets set-carryover --month 2026-03 --category <id> --flag true

# Hold funds for next month
actual budgets hold-next-month --month 2026-03 --amount 10000

# Reset held funds
actual budgets reset-hold --month 2026-03
```

### Categories

```bash
# List all categories
actual categories list

# Inspect categories: duplicates, hidden/deleted rows, merge targets, transaction counts
actual categories inspect [--include-deleted] [--name <text>]

# Create a category
actual categories create --name "Groceries" --group-id <id> [--is-income]

# Update a category
actual categories update <id> [--name "Food"] [--hidden true] [--group-id <id>]

# Delete a category (with optional transfer)
actual categories delete <id> [--transfer-to <id>]
```

### Category Groups

```bash
# List all category groups
actual category-groups list

# Create a category group
actual category-groups create --name "Essentials" [--is-income]

# Update a category group
actual category-groups update <id> [--name "New Name"] [--hidden true]

# Delete a category group (with optional transfer)
actual category-groups delete <id> [--transfer-to <id>]
```

### Transactions

```bash
# List transactions for an account within a date range
actual transactions list --account <id> --start 2026-01-01 --end 2026-03-31

# Add transactions (inline JSON)
actual transactions add --account <id> --data '[{"date":"2026-03-13","amount":-5000,"payee_name":"Store"}]'

# Add transactions (from file)
actual transactions add --account <id> --file transactions.json

# Import transactions with reconciliation (deduplication)
actual transactions import --account <id> --data '[...]' [--dry-run]

# Update a transaction
actual transactions update <id> --data '{"notes":"Updated note"}'

# Delete a transaction
actual transactions delete <id>

# Show one transaction with split children, split balance and transfer counterparts
actual transactions get <id>

# Set one category on a frozen list of transactions (guarded; "none" clears it)
actual transactions categorize --ids <id>,<id> --category <id> --operation-id <unique-id> [--allow-reconciled]

# Merge two duplicate transactions (guarded; the engine keeps the imported or earlier one)
actual transactions merge --ids <id>,<id> --operation-id <unique-id> [--allow-reconciled]

# Split a transaction, or replace its split children (guarded; children must sum to the amount)
actual transactions split <id> --data '[{"amount":-400,"category":"<id>"},{"amount":-600,"category":"<id>"}]' --operation-id <unique-id> [--allow-reconciled]

# Mark transactions cleared (or --uncleared); --unlock removes the reconciled lock (guarded)
actual transactions clear --ids <id>,<id> --operation-id <unique-id> [--uncleared] [--unlock]
```

`transactions categorize` freezes the selected IDs and their current categories in the preview. Apply rejects the batch with `STALE_PREVIEW` if any record changed after preview, instead of widening or narrowing it. Split parents are rejected (categorize their children), transfers between two on-budget accounts and off-budget transactions cannot take a category, and reconciled transactions need `--allow-reconciled`; the proposal lists them in `reconciledIds`. Rules are not rerun. Preview the same batch with `actual changes preview transactions.categorize --operation-id <unique-id> --data '{"ids":["<id>"],"category":"<id>"}'`.

`transactions split` writes through the shared split helpers. Children take `amount` and optional `category`, `notes` and `payee` (inheriting the parent payee). Their amounts must sum to the parent amount, so an invalid split fails before any write. Re-splitting a parent lists the replaced children in `removedChildIds`; the parent amount, date, account and cleared flag stay unchanged and the parent category is cleared. Split children, transfers and, without `--allow-reconciled`, reconciled transactions are rejected. The receipt outcome lists the new child IDs.

`transactions merge` uses the engine's merge owner. The preview names `keepId` (imported over manual, then the earlier date) and `dropId`, split children that move or are deleted, and transfer counterparts merged by the same rule. Both rows must be in the same account with the same amount, split children cannot be merged, and reconciled rows need `--allow-reconciled`. The kept row fills its empty payee, category, notes and schedule from the dropped row; the dropped row is tombstoned.

`transactions clear` sets the cleared flag on a frozen list of transactions. Reconciled transactions are rejected unless `--unlock` is passed, which removes their reconciled lock (listed in `unlockedIds`); it never marks anything reconciled, which belongs to reconciliation. Select a split parent rather than its children: the children follow the parent's cleared and reconciled state. Amounts, dates, accounts and categories are unchanged and rules are not rerun. To reverse a clearing, run it again with the opposite flag; to reverse a categorization, categorize back to the category in the receipt's `before` record.

### Payees

```bash
# List all payees
actual payees list

# List common payees
actual payees common

# Inspect payees: duplicates, merged rows and transaction counts
actual payees inspect [--include-deleted] [--name <text>]

# Create a payee
actual payees create --name "Grocery Store"

# Update a payee
actual payees update <id> --name "New Name"

# Delete a payee
actual payees delete <id>

# Merge multiple payees into one
actual payees merge --target <id> --ids id1,id2,id3
```

### Tags

```bash
# List all tags
actual tags list

# Create a tag
actual tags create --tag "vacation" [--color "#ff0000"] [--description "Vacation expenses"]

# Update a tag
actual tags update <id> [--tag "trip"] [--color "#00ff00"]

# Delete a tag
actual tags delete <id>
```

### Notes

```bash
# Read a note (prints the live target and the text, or null when there is no note)
actual notes get --account <account-id>
actual notes get --category <category-id> [--month 2026-10]
actual notes get --group <group-id>
actual notes get --month 2026-10

# Replace a note through a guarded change (an operation ID is always required)
actual notes set --account <account-id> --note "Statement closes on the 3rd" --operation-id <unique-id>
actual notes set --month 2026-10 --clear --operation-id <unique-id>
```

Note IDs follow the app: `account-<id>`, a category or group ID, `budget-<YYYY-MM>` for a month and `<category-id>-<YYYY-MM>` for a category's month note; a raw ID can be passed instead of a flag. Targets must be live, so a typo or deleted entity is rejected instead of creating an orphan note. Reading a missing note returns `null` and writes nothing. `notes set` runs the guarded `notes.set` change (`actual changes preview notes.set <note-id> --data '{"note":"text"}'` works too), rejects stale previews and returns a receipt. Category notes can carry `#template` and `#goal` lines, so the preview warns that budget templates reading notes will use the new text.

### Preferences

```bash
# List synced preferences with scope, authority, allowed values, app default and current value
actual preferences inspect [key]

# Change or reset an allowlisted preference (an operation ID is always required)
actual preferences set dateFormat yyyy-MM-dd --operation-id <unique-id>
actual preferences reset dateFormat --operation-id <unique-id>
```

Only synced budget preferences are covered; device-local settings never sync and budget metadata such as the name belongs to `budgets rename`. Settable keys are display settings (`dateFormat`, `numberFormat`, `hideFraction`, `isPrivacyEnabled`, `defaultCurrencyCode`, `currencySymbolPosition`, `currencySpaceBetweenAmountAndSymbol`, `firstDayOfWeekIdx`, `upcomingScheduledTransactionLength`, `show-hidden-tags`) and `flags.<feature>` experimental flags, each with validated values. Domain-owned keys are listed with their owner and rejected here: `budgetType`, `cashPlanning` (its typed tool), import mappings and bank sync options. Unknown keys fail. Inspection never writes, and an unset key reports `null` with the app default alongside. `reset` clears the stored value so the app falls back to its default. Changes run the guarded `preferences.set` change (`actual changes preview preferences.set <key> --data '{"value":"..."}'`, or `{"value":null}` to reset).

### Cash Planning

```bash
# Balances, history averages, category totals, projections and goal dates (read-only)
actual cash-planning inspect [--start 2026-08-01] [--end 2026-09-30] [--scenario '{"categoryTargets":{"<id>":50000},"goal":{"balance":2000000,"deadline":"2027-06-30"}}']

# Guarded saves of the synced cashPlanning preference (each requires --operation-id)
actual cash-planning save --data '{"startDate":"2026-08-01","endDate":"2026-09-30","categoryTargets":{},"forecastEndDate":"2027-12-31"}'
actual cash-planning set-target --category <id> --amount 50000
actual cash-planning reset-target --category <id>
actual cash-planning set-goal --balance 2000000 [--deadline 2027-06-30] | --clear
actual cash-planning reset
```

`cash-planning inspect` uses the same calculation functions as the Cash planning report. It returns included on-budget balances, history months as calendar fractions, income, outflow and external-movement averages, category totals, the historical and target projections (goal state, completion, depletion and deadline gaps) and the chart points. `--start`, `--end` and `--scenario` are transient: they override the saved plan for this call only and are never stored. With no history in the range, projections are `null` with a warning. Saves validate the whole plan the way the report reads it back and write only the `cashPlanning` preference; transactions, allocations, templates and schedules are unchanged. Removing a target restores that category's unrounded historical average. The edit helpers read the saved plan first, so a concurrent change before apply makes the preview stale rather than being overwritten.

### Transfers

```bash
# Unlinked opposite entries in different accounts within a date window (read-only)
actual transfers candidates [--account <id>] [--start 2026-10-01] [--end 2026-10-31] [--days 3] [--limit 200]

# One transaction's link checked from both sides, and a budget-wide link audit (read-only)
actual transfers inspect <id>
actual transfers check [--account <id>]

# Guarded link changes (each requires --operation-id)
actual transfers match --ids <id>,<id> [--allow-reconciled]
actual transfers unmatch <id> [--allow-reconciled]
actual transfers repair <id> [--allow-reconciled]
```

`transfers candidates` pairs unlinked leaf transactions whose amounts cancel, in different accounts, at most `--days` apart. Each pair carries both legs (account, date, payee, imported, cleared and reconciled state), the date gap, a classification and `ambiguous` with the alternative IDs when either leg has more than one candidate. Classifications follow the engine's transfer rule: `internal` (two on-budget accounts, including card payments; net budget cash is unchanged and the category is cleared), `off-budget-internal`, and `budget-boundary` (on-budget to off-budget, such as cash to equity; it moves money out of or into the budget once and keeps its category). Rows whose payee is already a transfer payee are reported by `inspect` and `check`, not offered as candidates.

`transfers match` links two existing entries without adding or deleting a transaction: both get the other account's transfer payee and the link, amounts and dates stay as recorded, and categories are cleared only for internal transfers. Ambiguity is never resolved for you; match the pair you choose, and a leg that is already linked is refused. Split rows are refused (set the child's payee to a transfer payee with `transactions split`), and reconciled rows need `--allow-reconciled`. To record a new transfer, add a transaction with the destination account's transfer payee; the engine creates the counterpart.

`transfers unmatch` unlinks a healthy transfer and keeps both rows as ordinary transactions with no payee, since a transfer payee would relink them on the next edit; delete an unwanted leg with `transactions delete`. `transfers inspect` reports `missing-counterpart`, `not-reciprocal`, `amount-mismatch`, `payee-mismatch`, `same-account` and `unlinked-transfer-payee`, plus the repair that applies: `unlink` removes a broken link from this row only, `resync` makes the counterpart follow this row through the engine's linked transfer update, and `relink` recreates a missing counterpart through the engine's transfer creation (this adds one transaction, disclosed in the preview).

### Imports

```bash
# Inspect or parse an import file without importing (read-only)
actual imports inspect statement.csv [--account <id>] [--no-saved] [--settings '{"fields":{"date":"Posted","payee":"Who","outflow":"Debit","inflow":"Credit"},"dateFormat":"dd mm yyyy","delimiter":";"}'] [--limit 20]
actual imports parse statement.ofx [--account <id>] [--limit 1000]

# Saved per-account import settings (guarded writes require --operation-id)
actual imports mappings get --account <id> [--format csv]
actual imports mappings set --account <id> [--format csv] --settings '{"fields":{...},"dateFormat":"dd mm yyyy","flipAmount":true}'
actual imports mappings reset --account <id> [--format csv]

# Import a file into an account (preview is read-only; apply is guarded)
actual imports preview statement.ofx --account <id> [--settings '{...}'] [--no-saved] [--skip-invalid] [--no-reimport-deleted|--reimport-deleted] [--uncleared] [--payee-names original]
actual imports apply statement.ofx --account <id> --operation-id <unique-id> [--expect-sha256 <hash>] [same options]
actual imports batch manifest.json --operation-id <id> [--dry-run] [--no-reimport-deleted] [--uncleared] [--payee-names original]
actual imports history [--operation-id <id>]
```

Import inspection runs the same parser as the import dialog (CSV and TSV, QIF, OFX and QFX, and CAMT.053 XML) and the same shared field-mapping, date and amount rules, so a candidate here is what the dialog would import. The result reports the format, size and SHA-256 of the file, the settings used with the source of each (`request`, `saved`, `detected` or `default`), CSV columns, the date range of valid rows, and each row with its normalized transaction (date, integer amount, payee, notes, category name and the OFX/QFX transaction ID as `imported_id`) or its errors. Rows with unparseable dates, malformed amounts or missing mapped columns are reported, never dropped. When several date formats parse every row (for example `03/04/2026`), nothing is normalized until you pass `settings.dateFormat`. Files over 10 MiB and unsupported types are rejected. Inspection never writes to the budget.

CSV settings are `fields` (map `date`, `amount` or `outflow`/`inflow`, `payee`, `notes`, `inOut`, `category` to column names), `dateFormat` (`yyyy mm dd`, `yy mm dd`, `mm dd yyyy`, `mm dd yy`, `dd mm yyyy`, `dd mm yy`), `delimiter`, `encoding`, `hasHeaderRow`, `skipStartLines`, `skipEndLines`, `inOutMode` with `outValue`, and `flipAmount` (for card exports with positive charges). QIF uses `dateFormat`, `flipAmount` and `swapPayeeAndMemo`; OFX/QFX uses `swapPayeeAndMemo` and `fallbackMissingPayeeToMemo`. `multiplier` applies to one inspection only. `imports mappings set` stores settings in the same synced preferences, with the same serialization, that the import dialog reads and writes, so a mapping saved from the CLI is the dialog's next default and the reverse. Supported formats are those of the parser; no institution-specific export is claimed.

`imports preview` parses the file as `imports inspect` does and then plans the import through the same engine path as the import dialog and `transactions import`: rules run, duplicates are matched, and nothing is written. Each row gets an outcome: `add`, `update` (matched and changed, for example gaining its imported ID), `duplicate` (matched with nothing to change), `reconciled` (matched a locked row, left alone), `deleted` (matched a deleted row while deleted rows are not reimported), or `invalid` with its errors. A matched row names the transaction it matched and how: `imported_id` (exact bank ID), `payee_date_amount` or `date_amount`. The last two are the engine's heuristic matching within seven days and the same amount; review them before applying. The preview also lists the planned new and updated rows after rules, new payee names, category names that match no category, the file hash and the resolved settings and options (`defaultCleared`, `reimportDeleted` resolved from the account preference when not given, `payeeNameNormalization`, `invalidRows`). A file with any invalid row is rejected unless `--skip-invalid` is given; files over 1000 rows are rejected.

`imports apply` is a guarded change. Its proposal freezes the file hash, resolved settings and options; apply prepares again and rejects with `STALE_PREVIEW` if the file, the saved mapping, an option or the affected ledger changed, so a token from `changes preview imports.file --data '{"path":"/abs/statement.ofx","accountId":"..."}'` never imports a different file. `--expect-sha256` with the hash from `imports preview` rejects a direct apply whose file changed since you reviewed it. The commit is verified against the planned rows. `imports history` lists the file imports in this device's change journal with their hash, settings, options, planned summary and result; it reads only the local journal, so imports made in the browser or on another device are not listed.

`imports batch` takes a JSON manifest, an array of up to 20 entries `{"file":"bank.ofx","account":"<id>","settings":{...},"useSaved":true,"skipInvalid":false}` with paths relative to the manifest. Each file is its own guarded import with operation ID `<id>-1`, `<id>-2` and so on, applied in order so later files are matched against rows committed by earlier ones. The batch stops at the first failure with `PARTIAL_COMPLETION`: the error details list committed, failed and not-attempted files. Rerunning with the same `--operation-id` returns stored receipts for committed files and never replays an uncertain one. After importing, the result lists transfer candidates (see `transfers candidates`) over the imported date range of each account; nothing is linked automatically. `--dry-run` previews every file against the current ledger and lists rows of later files that duplicate a row of an earlier file for the same account (`overlaps`); it does not list transfer candidates because the new rows do not exist yet.

### Rules

```bash
# List all rules
actual rules list

# List rules for a specific payee
actual rules payee-rules <payeeId>

# Create a rule (inline JSON)
actual rules create --data '{"stage":"pre","conditionsOp":"and","conditions":[...],"actions":[...]}'

# Create a rule (from file)
actual rules create --file rule.json

# Update a rule
actual rules update --data '{"id":"...","stage":"pre",...}'

# Delete a rule
actual rules delete <id>

# Test the rules on a sample transaction (read-only)
actual rules test --data '{"account":"<id>","date":"2026-10-04","amount":-450,"payee_name":"coffee bar"}' [--payee-names original]

# Transactions a rule selects now, then apply its actions to a frozen list (guarded)
actual rules matches <ruleId> [--limit 500]
actual rules apply <ruleId> --ids <id1,id2> --operation-id <unique-id> [--allow-reconciled]
```

`rules test` runs the sample through the same steps as an imported row: the payee name is normalized and resolved (title case by default, as imports do), then the rules run in their engine order (stage `pre`, then default, then `post`). It returns the sample as resolved, the result, the fields that changed, the rules whose actions ran in order with their definitions, and payee names an import would create (including a name set by a rule). Nothing is written: no payee is created and no rule is learned. Use it to check that a merchant is categorized before importing.

`rules apply` is the rule editor's "apply actions" as a guarded change: the rule's actions (including splits, formulas and `delete-transaction`) are applied to the listed transactions only; other rules and category learning do not run. Preview (`changes preview rules.apply --data '{"ruleId":"...","ids":[...]}'`) lists each row before and after, split children as `newChildOf` with their position, deletions as `tombstone`, and payee names that would be created. Every listed transaction must still match the rule's conditions and must not be a split parent (a splitting rule also excludes split children). Reconciled transactions need `--allow-reconciled`. Apply rejects with `STALE_PREVIEW` if the rule, the transactions or the ledger changed since preview, and verifies the written rows against the plan. `rules matches` lists the candidate IDs, newest first.

### Schedules

```bash
# List all schedules
actual schedules list

# Create a schedule
actual schedules create --data '{"name":"Rent","date":"1st","amount":-150000,"amountOp":"is","account":"...","payee":"..."}'

# Update a schedule
actual schedules update <id> --data '{"name":"Updated Rent"}' [--reset-next-date]

# Delete a schedule
actual schedules delete <id>
```

### Query (ActualQL)

Run queries using [ActualQL](./actual-ql/index.md).

#### Subcommands

| Subcommand                     | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `query run`                    | Execute an AQL query                           |
| `query tables`                 | List available tables                          |
| `query fields <table>`         | List fields and types for a table              |
| `query resolve <table> <text>` | Find entities by id or name; reports ambiguity |
| `query aggregate`              | Split-aware totals by category                 |

With `--output-version 2`, `query tables` and `query fields` read table, field, operator and function metadata from the core query schema, and `query run` compiles the query against that schema before connecting; an unknown table, field, path, operator or function, or a condition with several operators (only the first would apply; use `$and`), returns `INVALID_INPUT`. Version 2 results are `{ rows, page, snapshot }`: pages default to 1000 rows (maximum 10000), `page.truncated` and `page.nextCursor` describe continuation, non-aggregate queries get a final `id` tie-breaker, and repeating the same query with `--cursor <nextCursor>` continues it. If the budget changed since the previous page, `snapshot.changedSinceCursor` is true and a warning is added; use `--require-fresh` when another client may be writing.

`query resolve accounts "checking"` matches an exact id, then a case-insensitive exact name, then a substring, and returns `status` `unique`, `ambiguous` or `none` with the matches. Supported tables: accounts, payees, categories, category_groups, schedules, tags.

`query aggregate --start 2026-08-01 --end 2026-08-31 [--account <id>] [--splits leaves|parents]` returns engine totals by category with inflow and outflow. Transfers, starting balances and uncategorized rows are separate groups; deleted categories are marked `deleted` and missing ones `unavailable`. The grouped total always equals the engine total for the same scope.

#### `query run` Options

| Option                | Description                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `--table <table>`     | Table to query (use `actual query tables` to list)                                          |
| `--select <fields>`   | Comma-separated fields to select                                                            |
| `--filter <json>`     | Filter as JSON (e.g. `'{"amount":{"$lt":0}}'`)                                              |
| `--where <json>`      | Alias for `--filter` (cannot be used together)                                              |
| `--order-by <fields>` | Fields with optional direction: `field1:desc,field2` (default: asc)                         |
| `--limit <n>`         | Limit number of results                                                                     |
| `--offset <n>`        | Skip first N results (for pagination)                                                       |
| `--last <n>`          | Show last N transactions (shortcut: implies `--table transactions`, `--order-by date:desc`) |
| `--count`             | Count matching rows instead of returning them                                               |
| `--group-by <fields>` | Comma-separated fields to group by                                                          |
| `--file <path>`       | Read query from JSON file (use `-` for stdin)                                               |

#### Examples

```bash
# Show last 5 transactions (convenience shortcut)
actual query run --last 5

# Override default columns with --last
actual query run --last 10 --select "date,amount,notes"

# Transactions ordered by date descending with limit
actual query run --table transactions --select "date,amount,payee.name" --order-by "date:desc" --limit 10

# Filter with JSON — negative amounts (expenses)
actual query run --table transactions --filter '{"amount":{"$lt":0}}' --limit 5

# Use --where (alias for --filter, more intuitive for SQL users)
actual query run --table transactions --where '{"payee.name":"Grocery Store"}' --limit 5

# Count all transactions
actual query run --table transactions --count

# Count with a filter
actual query run --table transactions --filter '{"category.name":"Groceries"}' --count

# Group by category with aggregate (use --file for aggregate expressions)
echo '{"table":"transactions","groupBy":["category.name"],"select":["category.name",{"amount":{"$sum":"$amount"}}]}' | actual query run --file -

# Pagination: skip first 20, show next 10
actual query run --table transactions --order-by "date:desc" --limit 10 --offset 20

# Multi-field ordering
actual query run --table transactions --order-by "date:desc,amount:asc" --limit 10

# Run a query from a JSON file
actual query run --file query.json

# Pipe query from stdin
echo '{"table":"transactions","select":["date","amount"],"limit":5}' | actual query run --file -

# List available tables
actual query tables

# List fields for a table
actual query fields transactions
```

See [ActualQL](./actual-ql/index.md) for full filter/function reference including `$transform`, `$month`, `$year`, and aggregate functions.

### Server

```bash
# Get the server version
actual server version

# Look up an entity ID by name
actual server get-id --type accounts --name "Checking"
actual server get-id --type categories --name "Groceries"

# Trigger bank sync
actual server bank-sync [--account <id>]
```

## Amount Convention

All monetary amounts are represented as **integer cents**:

| CLI Value | Dollar Amount |
| --------- | ------------- |
| `5000`    | $50.00        |
| `-12350`  | -$123.50      |
| `100`     | $1.00         |

When providing amounts, always use integer cents. For example, to budget $50, pass `5000`.

**Output formatting:** Table (`--format table`) and CSV (`--format csv`) output automatically converts cent values to decimal (e.g. `1665.00` instead of `166500`). JSON output always returns raw cents for programmatic use.

## Output Formats

The `--format` flag controls how results are displayed:

- **`json`** (default) — Machine-readable JSON output, ideal for scripting. Query results are returned as a bare array of records.
- **`table`** — Human-readable table format. Amount fields are auto-formatted as decimals.
- **`csv`** — Comma-separated values for spreadsheet import. Amount fields are auto-formatted as decimals.

Use `--verbose` to enable informational messages on stderr for debugging or visibility into what the CLI is doing.

## Common Workflows

**View your budget for the current month:**

```bash
actual budgets month 2026-03 --format table
```

**Check an account balance:**

```bash
# Find the account ID
actual server get-id --type accounts --name "Checking"
# Get the balance
actual accounts balance <id>
```

**Export transactions to CSV:**

```bash
actual transactions list --account <id> --start 2026-01-01 --end 2026-12-31 --format csv > transactions.csv
```

**Add a transaction:**

```bash
actual transactions add --account <id> --data '[{"date":"2026-03-14","amount":-2500,"payee_name":"Coffee Shop"}]'
```

## Tips & Common Pitfalls

- **Split transactions:** When summing or counting transactions, filter `"is_parent": false` to avoid double-counting. A split parent holds the total amount, and its children hold the individual parts — including both counts the total twice.
- **Avoid rapid sequential requests:** Each CLI invocation opens a new server connection. Running queries in a tight loop (e.g. one per month) may trigger rate limiting or authentication failures. Instead, fetch all data in a single query with a date range filter and process locally.
- **Uncategorized transactions:** `category.name` is `null` for transactions without a category. Account for this when filtering or grouping by category.
- **No date sub-fields in AQL:** `date.month`, `date.year`, etc. are not supported as query fields. To group by month, fetch raw transactions with a date range filter and aggregate locally in a script.

## Self-Signed SSL Certificates

If your Actual sync server uses a self-signed SSL certificate, the CLI will reject the connection by default. You can address this by adding your CA certificate to the system's trusted certificates, though the details are beyond the scope of this document.

Alternatively, you can allow connections to a server that uses a self-signed certificate by setting the `NODE_TLS_REJECT_UNAUTHORIZED` environment variable:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 actual budgets list
```

Or export it for the entire session:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
actual budgets list
```

:::caution Security
Setting `NODE_TLS_REJECT_UNAUTHORIZED=0` disables all TLS certificate verification, which makes the connection vulnerable to man-in-the-middle attacks. Only use this in trusted network environments where you control the server and understand the risks.
:::

## Error Handling

- Non-zero exit codes indicate an error
- Errors are written as plain text to stderr (e.g., `Error: message`)
- Use `--verbose` to enable informational stderr messages for debugging

## Local budget creation

Create and use a budget without opening a browser:

```bash
actual --offline --data-dir ./actual-data budgets create --name "My finances" --currency USD --operation-id create-finances
actual --offline --data-dir ./actual-data --budget-id <returned-id> --output-version 2 accounts create --name Checking --balance 10000 --operation-id create-checking
```

`budgets create` returns version 2 JSON, including the local budget ID and `published: false`. It preserves the default categories. It rejects duplicate names and removes incomplete creation files after an initialization failure. Currency is optional and uses the existing synced preference.

Use the returned ID for later offline commands. Creation does not change a saved profile or publish to a configured server. The public API exposes `createBudget({ name, currency })` with the same local creation behavior.

## Budget inspection, selection, and cloning

```bash
actual --offline --data-dir ./actual-data --budget-id <id> budgets inspect
actual --data-dir ./actual-data budgets select <id> --save-profile personal
actual --profile personal budgets clone --name "Planning copy" --operation-id clone-planning
```

These operations return version 2 JSON by default. Inspection reports local and sync identities, encryption key identity, and currency. Selection validates the local ID, saves it in the named offline profile, and selects that profile. Explicit command-line and environment configuration still take precedence.

Cloning preserves ledger data and preferences under a new local ID and synchronization clock. It requires offline mode and removes the source's cloud file ID, sync ID, and encryption key identity. The copy is never published automatically. Cloning does not change a saved profile. Use its returned ID for subsequent commands. The public API exposes `inspectBudget()` and `cloneBudget({ name })`; initialize without a server before cloning.

## Explicit publication, rename, and archive

```bash
actual --server-url http://localhost:5006 budgets publish <local-id> --operation-id publish-personal
actual --offline --budget-id <local-id> budgets rename --name "Personal finances" --operation-id rename-personal
actual --offline --budget-id <local-id> budgets archive --operation-id archive-personal
actual --offline --budget-id <local-id> budgets archive --restore --operation-id restore-personal
```

Publication authenticates with configured credentials and selects the local ID by argument. It ignores inherited offline profiles and selectors. Explicit `--offline`, `--budget-id`, or `--sync-id` flags are rejected for publication. The result supplies the sync and cloud identities; use the sync ID for later online commands.

Configure an encryption password through `ACTUAL_ENCRYPTION_PASSWORD_FILE` or a profile secret file reference to encrypt the first upload. This requires a server that advertises `encrypted-initial-publication` in `/health`. The server registers the key salt and encrypted test content with the encrypted upload. No plaintext budget snapshot is uploaded first. Without an encryption password, the budget remains unencrypted.

A lost upload response reports partial completion. Inspect the budget and retry with the same server and encryption mode. Publication retains and checks one file identity, so it recovers an accepted upload without creating a duplicate. It does not silently recreate a published file that disappeared remotely. An acknowledged operation ID returns the original receipt and remote identity without uploading. Use synchronization commands for subsequent ledger changes.

Rename preserves identity and uses synced budget metadata. Archive requires offline mode and sets a reversible device-local marker. `budgets list` discloses that marker. Archive retains the ledger and does not delete a remote file. Cloning and export omit local publication and archive state. Publication does not change a saved profile.

The supported public methods are `publishBudget(id, { encryptionPassword })`, `renameBudget(name)`, and `archiveBudget(archived = true)`. Guarded publication adds `previewBudgetPublication`, `applyBudgetPublication`, and `recoverBudgetPublication` for source-bound proposals and recovery.

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

Guarded publication uses `actual changes preview budgets.publish <local-id> --operation-id <unique-id> --data '{"encrypted":true}'`, followed by `changes apply` with the exact token. Credentials use existing secret options and never enter receipts. Direct version 2 publication requires an operation ID. Retry the same ID and server/mode after partial completion. Uncertain recovery checks the retained remote identity and encryption proof. It never initial-uploads if remote acceptance cannot be proven. Acknowledged retries reuse the original outcome.

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

Guarded group updates use `actual changes preview category-groups.update <group-id> --operation-id <unique-id> --data '{"name":"Income","is_income":true,"hidden":false}'`. Supply at least one group field. An optional `id` must match the target. Nested `categories` are read metadata and never update child rows. The shared owner now accepts that declared metadata instead of attempting to store it in the group table. Names retain exact spelling, and omitted fields retain their values. Preview preserves data and binds the group, children and source state. Apply rejects stale or tampered proposals and verifies the actual group row. Direct version 2 `category-groups update` requires `--operation-id`; acknowledged retries preserve later edits, and uncertain outcomes never replay.

Guarded group deletion uses `actual changes preview category-groups.delete <group-id> --operation-id <unique-id> --data '{"transferCategoryId":"destination-category-id"}'`. The destination is optional. A destination must be a live category outside the deleted group. Preview preserves data and binds all children, forwarding mappings, live child allocations and source state. Apply tombstones the group and every child, including previously deleted children. With a destination, it forwards mappings and transfers live child allocations for every created month, for both income and expense groups. It preserves source allocations and raw transaction rows. Without a destination, it preserves mappings and allocations. Direct version 2 `category-groups delete` requires `--operation-id`; `--transfer-to` retains its existing meaning. Acknowledged retries preserve later destination edits and allocations, and unknown outcomes never replay.
