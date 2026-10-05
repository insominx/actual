# Implementation: 0036 cli-personal-setup

## Slice 1: checklist

- `personal-setup-checklist.md`: disposable-clone recipe, fixture-only completion note, and deferred real-budget HITL path.

## Slice 2: fixture-only acceptance (D6)

- `packages/cli/integration/personal-setup.test.mjs`: runs the checklist path on synthetic Chase checking, Capital One Debit/Credit, Robinhood cash (+ positions `no-route`):
  1. `workflow setup` for the three accounts
  2. Move opening balances before back-filled history (D5)
  3. `backups create` before mutations (A3)
  4. `imports inspect` / `imports preview` on the Chase file (A1)
  5. `jobs create` / `jobs run` with saved routes; positions stay `no-route`
  6. Categorize, `transfers match`, `transfers check` (A2)
  7. `checkup statement add` + `workflow monthly-close --finish` against computed statement totals 767000 / -11500 / 120000
  8. `reports net-worth` and `checkup data-quality`
- No production code beyond the test. No real budget opened. No personal export committed.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Fixture personal-setup (A1-A3) | `yarn workspace @actual-app/cli exec node --test integration/personal-setup.test.mjs` | Pass (`verification-personal-setup-linux.txt`) |
| Real exports / personal budget | — | Out of scope (D6; Michael declined) |

Windows personal adoption remains for Michael if he later supplies files and a budget id.
