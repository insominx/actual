# Implementation: 0033 cli-mcp

## Slice 1: thin adapter entry

- `packages/cli/src/mcp.ts`: stdio JSON-RPC server, tool generation from `discoverOperations`, schema validation and argument mapping (`buildTools`, `toolArgv`), and child-process execution of the CLI (D2, D4, D5).
- `packages/cli/src/commands/mcp.ts`: `actual mcp serve [--domains <list>]`, forwarding global options except output selection; refuses `--output-version` because stdout carries protocol frames.

## Slice 2: discovery, resources and stdio lifecycle

- Tools with annotations, paged `tools/list`, resources `actual://domains`, `actual://operations`, `actual://schema/{tool}` (D3, D7). Cancellation and stdin close terminate child processes (D6). Child stderr is forwarded to stderr; stdout carries only frames.

## Slice 3: configuration examples and protocol tests

- `integration/mcp.test.mjs`: a raw JSON-RPC client test and an official SDK client test (skipped unless `ACTUAL_TEST_MCP_SDK` points at an installed `@modelcontextprotocol/sdk`). `src/mcp.test.ts` covers generation, mapping, forwarding and protocol errors.
- Docs: `cli.md` MCP section with an agent configuration example, README row, `upcoming-release-notes/agent-cli-mcp.md`. MCP stays optional; no CLI command depends on it.

## Verification (Linux)

| Check    | Command                                                                                  | Result                              |
| -------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`                                                    | 331/331 (adds `src/mcp.test.ts`, 4) |
| Types    | CLI `tsc --noEmit`                                                                       | clean                               |
| Packaged | `ACTUAL_TEST_MCP_SDK=<sdk dir> node --test integration/mcp.test.mjs` (SDK 1.32.0 client) | 2/2 (`verification-mcp-linux.txt`)  |

Acceptance mapping:

- A1: `accounts_list`, `cash-planning_inspect` with a scenario and `imports_preview` return `structuredContent.data` deep-equal to the CLI's version 2 `data`, and the raw budget tables are unchanged afterwards.
- A2: the tool count equals the registry minus the documented CLI-only commands; every tool's option properties and required fields deep-equal the registry schema and annotations follow `mutates`/`destructive`; an unknown tool, an extra argument, a wrong type and a missing required argument return `-32602` without running anything. No tool metadata contains the password.
- A3: a client initializes, reads `actual://domains` and a schema resource, previews (`changes_preview`) and applies (`changes_apply`) a categorization, sees a CLI failure as `isError` with the CLI error code, cancels an in-flight `workflow_weekly-checkup` (no response, `ping` still answers), reconnects with `--domains changes,workflow`, and reads the committed receipt through `changes_status`. The official SDK client lists tools, calls `accounts_list` with CLI-identical data and reads a resource.

Blocked portion: a live MCP host application (for example a desktop agent) was not available, so the configuration example is not verified end to end in a host (D8). Windows rerun pending.
