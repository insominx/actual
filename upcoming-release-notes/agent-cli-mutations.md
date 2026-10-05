---
category: Features
authors: [AI]
---

Add an initial guarded transaction preview/apply checkpoint and device-local receipt inspection. Ordinary, split, and linked transfer notes, amounts, dates, and cleared flags use engine-owned preconditions. Split previews capture the parent, every child, and their references; apply uses canonical inheritance and split error recalculation. Linked transfer previews also capture the counterpart and its split, when present. Counterpart amount edits recalculate its parent error without changing the parent total. Sibling, counterpart, and account reference edits reject stale proposals. Unknown outcomes never replay automatically. Real browser stale-edit rejection, three exact-phase process kills, and encrypted push-failure recovery are verified locally on Windows. Guarded allocation amount preview/apply also uses the canonical budget owner and preserves carryover/settings. Budget creation, clone, restore, rename, and local archive now use guarded proposals and receipts. Version 2 commands require operation IDs. Archive stays local-only and never deletes the remote budget. Acknowledged local-only creation/clone/restore/archive receipts can expire; uncertain receipts remain preserved. Guarded publication is verified locally on Windows; remaining mutation adapters stay under implementation.

Interrupted journal publication now removes only matching redundant staging copies. Orphaned or invalid staging files remain visible and block new mutation intent. Recovery preserves the published uncertain state rather than inferring commit from staged bytes.

Guarded local creation previews without reserving a name or inventing a budget ID. Apply acknowledges the actual new identity. Retained receipts prevent duplicate creation on retries; uncertain creation outcomes never replay automatically.

Guarded local clone fingerprints copied source tables, schema, and metadata. Source edits reject a prepared copy; unchanged reload/cache state remains valid. The canonical clone owner creates the isolated destination, and retained receipts prevent repeat cloning.

Guarded restore binds the validated archive hash and destination name without storing archive bytes in receipts. Version 2 restore requires an operation ID. Prepared applies revalidate input before writing; retained acknowledged retries reuse the original destination even after archive removal. Uncertain restore never replays.

Guarded account creation previews account, transfer payee and opening transaction consequences without creating a Starting Balance payee. Version 2 creation requires an operation ID and returns actual generated identities in its receipt. Retried acknowledged creation preserves later edits. Uncertain creation never replays based on a matching name. Online/offline creation and exact process interruption recovery are verified locally on Windows.

Guarded account updates preview canonical account fields and derived transfer payee names. Version 2 direct updates require operation IDs and retain both existing update options. Apply rejects stale ledger or references, and acknowledged retries preserve later account edits. Account updates preserve transactions and stored payees.

Guarded account reopening previews visibility without changing provider or ledger records. Version 2 reopening requires an operation ID. Receipts preserve later closures during acknowledged retries and never replay uncertain reopening. Bank relinking remains a separate action.

Guarded account deletion previews complete ledger and reciprocal transfer effects before applying through the canonical account owner. Version 2 deletion requires an operation ID and preserves actual outcomes for retries. Provider removal uncertainty remains explicit and distinct from budget synchronization. Closed-account deletion preserves the existing unlink-only behavior.

Version 2 account closure now uses guarded previews, bound closing transfers and durable receipts. Counterpart rules use canonical balance formulas without preview ledger writes. Account closure retains its existing transfer account/category options and legacy output. Receipts preserve generated identities and provider uncertainty through safe retries.

Version 2 category creation and updates now use guarded previews and durable receipts. Creation preserves canonical sibling ordering and self mappings, and receipts return actual generated IDs. Acknowledged retries preserve later edits and never recreate the category.

Version 2 category deletion now previews canonical mappings and expense allocation transfers, then applies through shared durable receipts. Acknowledged retries preserve later destination edits and allocations. Unknown outcomes never replay.

Version 2 category-group creation now uses guarded previews and durable receipts with actual generated group IDs. Income flags and exact names are preserved. Acknowledged retries retain later edits and never recreate the group.

Version 2 category-group updates now use guarded previews and durable receipts. Exact names and omitted fields are preserved. Nested category metadata never changes children. Acknowledged retries preserve later edits, and uncertain updates never replay.

Version 2 category-group deletion now previews child tombstones, forwarding mappings and live child allocation transfers through shared durable receipts. Raw ledger rows and source allocations remain preserved. Acknowledged retries retain later destination edits and allocations, and uncertain outcomes never replay.

Version 2 payee creation now uses guarded previews and durable receipts with actual generated payee and mapping IDs. Exact names and existing duplicate behavior are preserved, and uncertain creations never replay.
Version 2 payee updates, deletions and merges and tag creation, updates and deletions now use guarded previews and durable receipts through their existing owners.
Version 2 rule creation, updates and deletions now use guarded previews and durable receipts; schedule-owned rules stay with their schedule.
Version 2 schedule creation, updates and deletions now use guarded previews and durable receipts that bind the linked rule.
Version 2 transaction deletion is guarded with exact split and transfer cascades, and guarded transaction updates now cover category and payee.
Version 2 transaction additions and imports can opt into guarded previews and durable receipts with `--operation-id`.
Version 2 query discovery now reads the core query schema, invalid queries fail before connecting, results are paged with cursors that disclose concurrent changes, and new `query resolve` and `query aggregate` commands support entity lookup and split-aware totals.
