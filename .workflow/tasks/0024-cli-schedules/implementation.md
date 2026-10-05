# Implementation: 0024 cli-schedules

## Slice 1: occurrence metadata and inspect/upcoming

- Core `server/schedules/inspect.ts`: `inspectSchedules` and `scheduleOccurrences` (D2). Handler `api/schedules-inspect`; public `inspectSchedules` and types `ScheduleInspection*`.
- CLI `schedules inspect <id>` and `schedules upcoming [--start --end --account --include-completed]` (read operations, D9).

## Slice 2: CRUD and reset

- Already guarded: `schedules.create|update|delete` with `resetNextDate` (0014). No change (D7).

## Slice 3: post and skip

- Core `server/schedules/guarded-occurrence.ts`: guarded `schedules.post` (D3, D4, D5) and `schedules.skip` (D6). Types `ScheduleOccurrenceRequest`, `ScheduleSnapshot`, `SchedulePost*`, `ScheduleSkip*`; handlers `api/schedules-preview-post|post|preview-skip|skip`; public `previewSchedulePost`, `applySchedulePost`, `previewScheduleSkip`, `applyScheduleSkip`.
- CLI `schedules post <id> --date --operation-id [--today]`, `schedules skip <id> --date --operation-id`, `changes preview schedules.post|schedules.skip`; payload schema, journal outcomes, direct-command list.
- Docs: `cli.md` Schedules section, README row, `upcoming-release-notes/agent-cli-schedule-occurrences.md`. The docs state that tools record bills and never pay them.

## Verification (Linux)

| Check    | Command                                                                    | Result                                     |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| API      | `yarn workspace @actual-app/api exec vitest run -t "schedule occurrences"` | 1/1                                        |
| CLI unit | `yarn workspace @actual-app/cli test`                                      | 307/307                                    |
| Types    | loot-core, API and CLI `tsc`                                               | clean                                      |
| Packaged | `node --test integration/schedules-occurrences.test.mjs`                   | 12/12 (`verification-schedules-linux.txt`) |

Acceptance mapping:

- A1: `schedules inspect` returns every month end for the last-day pattern (Jan 31, Feb 28, Mar 31, Apr 30, May 31, Jun 30 2030), Feb 29 for a yearly leap-day schedule, second Fridays for a weekday pattern, the following Monday for a weekend-skip schedule, the transfer account for a transfer schedule, and keeps `next_date` after `--reset-next-date`; raw tables are unchanged by inspection.
- A2: posting the next occurrence adds one linked row; a retry with the same operation ID replays and a new ID is rejected; importing the matching bank row through `imports apply` matches the posted row and adds nothing. Posting the transfer schedule adds the counterpart in the other account.
- A3: editing the schedule amount and name, then deleting the schedule, leaves the posted row byte-identical (amount, date, live). Kill points before engine, after engine and before sync keep their outcome for post and skip (guarded-kit).

Limitations: Windows not run. In the API Vitest environment the engine's recurring date helpers returned every day as an occurrence for monthly schedules (both a fixed day and the last-day pattern), while the packaged CLI build computes them correctly; the API test therefore uses a one-off schedule and recurrence is proven by the packaged test. Item for Michael to review. Forecasts are not part of this slice; cash planning stays separate.

Decision audit: D1-D9 in execution-decisions.md.
