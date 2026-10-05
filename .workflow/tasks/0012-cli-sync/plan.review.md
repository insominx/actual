# Synchronization plan review

Reviewed 2026-10-03 by the implementing coordinator. This is not independent review.

The existing public API and engine own synchronization. The first checkpoint adds public local status, explicit refresh, and required-fresh reads. Status uses the engine checkpoint and separates received schema gaps from message candidates awaiting synchronization. It does not mutate ledger state. Offline freshness remains unknown.

Preserved invariants: no mutation replay during refresh; no direct CLI database access; encrypted sessions register keys through downloadBudget; selected identities remain stable; local locks do not serialize remote clients.

The lifecycle prerequisite now has packaged publication, rename, and archive proofs on Windows. Linux and browser interoperability remain final acceptance work. The sync task stays partial until A1-A3 pass, including browser convergence, post-write failure, watch cancellation, and bounded reconnect.
