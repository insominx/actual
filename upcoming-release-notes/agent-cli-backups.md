---
category: Features
authors: [AI]
---

Add atomic CLI backup creation, bounded manifest listing, isolated offline import validation, and restore-as-new. Backups record source identity, freshness, and archive hashes. Exports are plaintext, including for encrypted sync budgets. Restore creates a new local identity without publishing or replacing the source. The public restoreBudget API provides the same engine behavior. Offline comparison reports domain fingerprints and balance differences between explicit local IDs. Retention previews a per-source policy and requires --apply for deletion. It validates archives before choosing keepers and preserves corrupt or linked artifacts.
