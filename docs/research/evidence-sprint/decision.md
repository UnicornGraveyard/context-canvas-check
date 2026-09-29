# Go or no-go on v0.1

**Status: DECIDED on 2026-09-27. No-go on the planned diff tool (A), and start option C.** Data collection finished on 2026-09-27, well ahead of the 2026-10-25 gate, and the decision was made the same day.

## Numbers against the thresholds

| | Result | Threshold | Met? |
|---|---|---|---|
| **H1: independent reports** | **41**. All 41 quotes were checked against the live pages. | ≥ 15 | **Yes** |
| **H2: baseline failure rate** | **10%** (3 of 30) after the protocol's review. 30% before review. 20% if the T6 heading change counts. | ≥ 15% | **No**, as reviewed |
| H3: gaps uncovered (shapes scope only) | Risk-labeled PR diffs of permissions and MCP config already exist in 6 tools, none with more than 3 stars. The gate enforcement map is uncovered. | n/a | n/a |

**Under the protocol:**
- **No-go** for v0.1 as specified, because go needs both thresholds.
- If Ian counts the T6 heading change as a failure, H2 is 20% and the rule says **go**.

See `benchmark/summary.md` for both readings.

## What the evidence says, whichever way the rule falls

1. **The pain is real, but it isn't mainly the pain v0.1 targets.** The largest categories are:
   - **silent invalid config** (23 of 41);
   - **can't tell what's in effect** (12).
2. **Tools rewrite config more often than agents do.** In the reports of unexpected changes, 10 were tool-initiated and 7 agent-initiated. The tools included extensions, `/model`, approval flows and plugin handling.
3. **Review difficulty is rare** (3 of 41). People rarely say a change was hard to review. They say they never saw it, or it silently didn't apply.
4. **With a clear request, the agent was careful.** Opus 5.5 got 27 of 30 config edits right.
   - It explained every change and its consequence.
   - Claude Code's protected paths made a person approve each edit to `.claude/**` and `.mcp.json`.
   - The one material failure was in an unprotected instruction file (CLAUDE.md). It removed a production review requirement with no prompt.
5. **The field failures are mostly the kind the benchmark didn't test.** They are *unrequested* agent edits to instruction files and guardrails: weakening a hook, removing guardrails, rewriting CLAUDE.md. That is a limitation of the benchmark design, not a change to its result.
6. **The planned v0.1 would be the seventh tool in a niche with no traction.** agentshield, a config security scanner, does have traction: 1,229 stars and about 37,000 npm downloads a month. Nothing maps declared gates to what actually enforces them.

## Options

- **A. Record no-go (recommended).**
  - Publish the findings as a post. Stop building v0.1.
  - This follows the rule as reviewed. It is also the honest reading of H3: the diff already exists, and demand for it is weak.
- **B. Count T6 as a failure and go.**
  - Even then, H3 says the planned v0.1 core already exists. Going would mean rescoping to the uncovered parts: subagent frontmatter, hooks, skills, removals.
  - The evidence for that narrower scope is thin.
- **C. No-go now, then a new narrow test** (only if there is still time to build).
  - Pre-register a 2-week test of a different hypothesis: *a verifier that says whether agent config actually applies*. It would cover silent-failure classes, what's in effect and why, drift when tools rewrite config, and the gate enforcement map.
  - A cheap first check: how many of the 23 silent-failure reports could a deterministic checker catch?
  - Contributing to agent-assurance (Apache-2.0) or settings-effective (MIT) is a cheaper alternative to a new tool.

**Recommendation: A, keeping C open.** The sprint did its job. It stopped a build the evidence doesn't support, and it found where the real pain is.

## Decision

**A, then C.** Decided by Ian MacDowell on 2026-09-27.

- **No-go for v0.1 as specified** (the risk-labeled PR diff). This accepts the reviewed H2 result (10%): the T6 heading change is not counted as a failure. The findings go out as a post.
- **Option C started the same day.** A pre-registered test of a checker that says whether agent config actually applies, in [`../option-c/protocol.md`](../option-c/protocol.md). It said go the same day; see [`../option-c/decision.md`](../option-c/decision.md).
- The hosted app stays as it is.
