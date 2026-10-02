# Cash planning

Source: the user-supplied Personal cash planning for Actual plan, 2026-10-02.

Deliver a read-only summary and responsive report at `/reports/cash-planning`.
Sum signed on-budget ledger balances through today, including closed accounts and opening balances.
Classify split leaves once; remove internal transfers; keep boundary transfers separate.
Average income and category outflows over inclusive calendar-month fractions.
Store targets, history dates, forecast end, and one optional goal only in the synced `cashPlanning` preference.
Use unrounded monthly rates for both projections, goals, deadlines, and net cash depletion.
Mask figures during requests/errors. Discard obsolete requests and refresh on applied changes and undo.
Reuse imports, transfer matching and reconciliation. Do not alter allocations, templates, schedules, or the forecast API.

Acceptance: the six numeric examples and read-only/persistence constraints in the supplied plan.
Verify focused core/client tests, desktop/mobile browser workflows, root type checking, targeted formatting/lint and browser build.
Document actual export validation as a separate setup step. Use disposable budgets.

Authority: core `server/cash-planning` owns summary classification; shared `cash-planning` owns date and projection arithmetic.
Ledger data is authoritative; query results are derived; form values remain unsaved until Save.
Existing preferences/sync paths own persistence. No database migration.
Risks: split inheritance, signed refunds, stale in-flight queries, synced settings overwriting unsaved edits.
