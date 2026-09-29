# Option C: go or no-go

**Status: DECIDED on 2026-09-27. Go.** Collected and scored on 2026-09-27, ahead of the 2026-10-04 date.

## The rule's outcome

| | Result |
|---|---|
| G1 | 13 of 18 detectable. **Met** (≥ 9) |
| G2 | 10 of 13 uncovered under the recorded reading. **Met**, but **not met** (38%) if every "partial" counts as covered |
| G3 | 10 mechanisms. **Met** (≥ 3) |

- **Under the recorded reading: go.**
- **Under the strict reading of G2: no-go.** See [summary.md](summary.md).

## Options

- **Go: build v0.1 of `context-canvas check` (recommended).**
  - **Scope:** the 10 checks in `summary.md`, each tied to a report. Claude Code only.
  - **Delivery:**
    - a CLI (`npx`) that reads a project and, when run locally, the user settings;
    - one plain-language finding per problem, with the doc link;
    - a baseline file for the drift check;
    - `--json` output for agents.
  - **Integration:** a SessionStart or PostToolUse hook in a small Claude Code plugin, plus a GitHub Action later.
  - **Build rules:**
    - Reuse core's parsers.
    - Build the lossless config model (a first-sprint lesson): no dropped keys, no truncation.
    - Publish core and the CLI only, after the checks in the plan (employment IP terms, secret scan).
  - **Adoption gate:** at week 4 after launch, continue only if there is at least one external repo using it, or an issue from someone outside the project.
- **No-go.** Use the strict reading. Publish both test results with the findings post, and stop.
- **Contribute instead.** Offer the documented checks to settings-effective (MIT) or agentshield. That is cheaper and keeps the post honest, but it won't produce a Context Canvas tool.

## Decision

**Go: build v0.1 of `context-canvas check`.** Decided by Ian MacDowell on 2026-09-27.

- This accepts the recorded reading of G2: a problem that shows only as something missing from a list counts as not caught.
- The scope is the 10 report-backed checks in `summary.md`, for Claude Code only.
- An adoption gate applies 4 weeks after launch.
