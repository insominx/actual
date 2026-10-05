# Implementation: 0026 cli-cash-planning

## Slice 1: inspection and guarded saves

- Core `packages/loot-core/src/server/cash-planning/plan.ts`: `inspectCashPlan` (summary through the 0006 summary owner, saved plan, `projectCashPlanning` for history and targets, chart), `strictCashPlanningConfig`, `prepareCashPlanSave`/`performCashPlanSave` over the synced `cashPlanning` preference. `storedPreference` exported from `preferences/catalog.ts`.
- Types `CashPlanInspectRequest`, `CashPlanInspection` (`models/cash-planning.ts`), `CashPlanSaveRequest`/`Proposal` (`change-proposals.ts`).
- Handlers `api/cash-planning-inspect`, `api/cash-planning-preview-save`, `api/cash-planning-apply-save`; public `inspectCashPlan`, `previewCashPlanSave`, `applyCashPlanSave`.
- CLI `packages/cli/src/commands/cash-planning.ts`: `inspect [--start --end --scenario]`, `save --data|--file`, `reset`, `set-target --category --amount`, `reset-target --category`, `set-goal --balance [--deadline] | --clear`. Every write needs `--operation-id`; `cash-planning.save` is a payload-scoped guarded operation.
- Docs: `packages/docs/docs/api/cli.md` Cash Planning section, CLI README row, `upcoming-release-notes/agent-cli-cash-planning.md`.

Fix during verification (commit 21740d847): reset now stores null, and inspection reports a null value as `stored: false`.

## Verification (Linux)

| Check    | Command                                                         | Result                                       |
| -------- | --------------------------------------------------------------- | -------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "cash plan"` | 1/1                                          |
| CLI unit | `yarn workspace @actual-app/cli test`                           | 298/298                                      |
| Types    | `npx tsc -b packages/loot-core`, API and CLI `tsc`              | clean                                        |
| Packaged | `node --test integration/cash-planning.test.mjs`                | see `verification-cash-planning-linux.txt`   |
| Browser  | `node --test integration/browser-cash-planning.test.mjs`        | 1/1 (`verification-cash-planning-linux.txt`) |

Limitations: Windows not run.

Decision audit: D1-D7 in execution-decisions.md.
