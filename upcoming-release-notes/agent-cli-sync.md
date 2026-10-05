---
category: Features
authors: [AI]
---

Add CLI synchronization status and refresh operations. Offline status reports pending and deferred engine messages without server access. The `--require-fresh` flag requires successful synchronization before a remote read. Cache locks remain held through engine shutdown.

Add bounded synchronization watch with polling, reconnect, cancellation, and worker deadlines. Failed pushes report retained local changes and invalidate cache freshness. Refresh sends existing writes without repeating mutations.
