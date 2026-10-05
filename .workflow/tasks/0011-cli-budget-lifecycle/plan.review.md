# Plan review

Last Edited: 2026-10-02

Coordinator review; no independent reviewer. Verdict: proceed with the local creation checkpoint.

Prerequisite 0009 delivers explicit offline sessions and shared profile/config types. Public API methods delegate to engine handlers. Existing `runImport` clears default categories and can upload during finish, so it is unsuitable for local creation. Reuse `create-budget` with `avoidUpload: true` through a supported public API handler.

Creation must validate before closing the selected budget. Currency must use the existing synced preference writer. The budgetfile owner must remove incomplete creation artifacts. A CLI lock serializes creation within a data directory; it does not coordinate other devices or browser processes.

First checkpoint: create a local budget, reopen it in a new process, create an account, and prove that configured remote budgets did not change. Inject a database-copy failure and prove cleanup. Do not claim clone isolation or publication acceptance until their later slices pass.

Windows is the available execution platform. Linux and browser interoperability remain downstream verification gaps. Full task acceptance requires inspect/select/clone/publish/rename/archive after this first checkpoint.
