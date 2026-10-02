Last Edited: 2026-10-02

Implementation update: tasks 0007-0009 now have production code and local verification records. The following planning validation is historical. Current status lives in cli-roadmap.json and the task progress files. The remaining 27 tasks are planned; Linux and browser interoperability remain unverified.

# CLI roadmap artifact validation

The task artifacts passed structural checks. This establishes a coherent planned queue, not working CLI features.

| Check                   | Result                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| Unique keys/folders     | 30 tasks; no duplicates                                                |
| Dependency graph        | All references resolve; listed order is topological; no cycles         |
| Plan/progress artifacts | 60 files present                                                       |
| Required plan sections  | All 30 plans contain sections 1, 2, 3, 7, 8, 12, 14                    |
| Acceptance checks       | Three specific acceptance checks per task; 90 total                    |
| Source owner paths      | All listed current owner paths exist                                   |
| Markdown local links    | 305 existing targets checked                                           |
| Scope                   | Workflow artifacts only; production CLI implementation has not started |

Each plan requires review before implementation. Dependent reviews reread predecessor-produced schemas and APIs. MCP is optional and has no outgoing prerequisite edge to CLI-only release. The personal adoption task requires user-provided exports and statements later.

No feature tests, type checks, or builds were run for these documentation-only changes. Existing uncommitted cash-planning production changes were preserved. Application verification belongs to the implementation tasks.

Repository `oxfmt --check` passed on all 64 roadmap/task files. `workflow-status --json` reported no conflicts, unnumbered tasks, or workflow warnings. `git diff --check -- .workflow` passed. Temporary generation/validation scripts were removed; only workflow artifacts remain.
