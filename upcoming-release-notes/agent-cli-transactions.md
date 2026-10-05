---
category: Features
authors: [AI]
---

Add guarded `actual transactions categorize`, which sets one category on a frozen list of transaction IDs. Previews list changed, unchanged and reconciled rows; split parents, on-budget transfers and off-budget rows are rejected, and any change to an affected record after preview makes the batch stale. Add guarded `actual transactions merge` for duplicate pairs, previewing which row the engine keeps. Add guarded `actual transactions split`, which rejects children that do not sum to the transaction amount before writing. Add guarded `actual transactions clear`, which marks transactions cleared or uncleared and removes a reconciled lock only with `--unlock`, and read-only `actual transactions get`.
