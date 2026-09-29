# Evidence sprint (2026-09-28 to 2026-10-25)

**Status: decided on 2026-09-27. No-go on the planned diff tool.** H1 was met (41 independent reports, all verified against their links). H2 was not: the reviewed failure rate was 10% (3 of 30), below the 15% threshold. The evidence pointed to config that silently doesn't apply, which is now under its own test in [`../option-c/`](../option-c/protocol.md). See [decision.md](decision.md).

This sprint decides whether to build Context Canvas v0.1: a review layer that shows what agents are allowed to do and what an agent just changed in its own configuration. We decide before building, from evidence.

- [protocol.md](protocol.md) holds the hypotheses, thresholds, benchmark tasks and scoring. It was pre-registered on 2026-09-27, before any data was collected.
- `voice-of-user/` holds the H1 reports (`quotes.json`), the pain table, and `check-quotes.mjs`, which checks every quote against its link.
- `benchmark/` holds the H2 fixtures, the tasks, the harness and the results.
- `teardown.md` is the H3 capability matrix.
- `decision.md` records the decision: no-go on the diff tool, and start option C, on 2026-09-27.

**Go** needs both of these:
- at least 15 independent reports;
- a baseline failure rate of at least 15% when Claude Code edits its own configuration without a helper tool.

In either case we publish the findings.
