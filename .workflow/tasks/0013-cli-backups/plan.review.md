# Backup plan review

Reviewed 2026-10-03 by the implementing coordinator. This is not independent review.

The lifecycle and synchronization prerequisites have Windows proofs, including a browser and two independent CLI caches. The public exportBudget/importBudget API and Actual importer remain the archive authority. CLI artifact code owns directories, hashes, and manifests. No new finance formulas or direct ledger writes are permitted.

First checkpoint: create a uniquely named backup directory containing an Actual zip and versioned manifest. Write files in a staging directory, flush them, verify bytes and hash, then rename the directory as one completed artifact. Explicit paths avoid accidental overwrite. The manifest reports identity, pending counts, observed checkpoint, and plaintext protection. Encrypted remote sync does not encrypt this export.

Further checkpoints remain mandatory: isolated import validation, restore with a new local identity, read-only comparison, corruption/overwrite boundaries, and retention that preserves the newest valid backup. Personal files and remote publication are not needed for synthetic proof. Existing receipts remain unavailable until task 0014.

Risks: archive plaintext, partial artifact writes, path/symlink boundaries, identity reuse during import, and incorrect configuration comparison. Verify each at its owning boundary before dependent mutation work begins.
