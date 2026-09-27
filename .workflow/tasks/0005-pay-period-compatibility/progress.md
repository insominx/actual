# Task Progress: pay-period compatibility study

Current status: active
Current phase: planning complete — ready for implement (study only)

## Human input required

- None to execute the study. Product direction is selected after evidence, before any production port.

## Agent next actions

- [ ] Pin the source implementation/ADR and produce the consumer/authority map.

## Implementation checklist

- [ ] Inspect pinned period math/config, allocation storage, API/import/export and report differences; write `survey.md` with target file/symbol owners.
- [ ] Add task-local synthetic date probes for weekly/biweekly/monthly ranges, month-end/leap/year boundaries and local dates; record results.
- [ ] Probe existing allocation preservation on cadence edits and off/on toggles, template funding, report/API behavior and reservation compatibility.
- [ ] Demonstrate concurrent cadence/allocation edits, stale-client and export/restore behavior with synthetic operation-order cases.
- [ ] Write `compatibility.md` comparing full port, read-only planning and existing forecasting; recommend go/defer/no-port against each invariant.
- [ ] Present evidence and future task scope; complete the study without implementing a production budget redesign.

## Acceptance trace

| Acceptance                    | Planned proof                             | Evidence                                               | Status  |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------ | ------- |
| Consumer/authority coverage   | Path/symbol map                           | Known guide limitations and local owner inventory      | Pending |
| Correct periods               | Reproducible date probes                  | Plan only                                              | Pending |
| Allocation/sync compatibility | Before/after and operation-order probes   | Source guide documents unsafe cadence reinterpretation | Pending |
| Decision-ready alternatives   | Evidence matrix and scoped recommendation | Plan only                                              | Pending |

## Execution decision ledger

Create `execution-decisions.md` for material changes to the study scope. Record source limitations and design choices in `compatibility.md`, with evidence.

## Execution log

- 2026-09-27 — Demoted broad pay-period port to a bounded compatibility study after rereading source limitations. No production implementation or probes performed.
