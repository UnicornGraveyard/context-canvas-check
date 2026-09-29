# Option C results: does agent config actually apply?

These results were produced on 2026-09-27 under [protocol.md](protocol.md). The per-report data is in [classification.json](classification.json) (final classes, both classifiers' calls, and resolutions) and [coverage.json](coverage.json). The raw inputs are `classification-a.json` and `classification-b.json`.

## Against the thresholds (18 Claude Code reports)

| Test | Result | Threshold | Met? |
|---|---|---|---|
| G1: detectable from config files | **13 of 18** (72%): D1 3, D2 7, D3 3 | ≥ 9 | **Yes** |
| G2: detectable and not caught by any existing tool | **10 of 13** (77%) under the reading recorded below | ≥ 50% | **Yes**, as recorded |
| G3: distinct mechanisms among those | **10** | ≥ 3 | **Yes** |

**G2 depends on how "partial" coverage counts.** The protocol didn't define it. Three readings:

| Reading | Uncovered | G2 |
|---|---|---|
| Every "partial" counts as covered (strict) | 5 of 13 (38%) | not met |
| **Recorded:** a tool that flags the problem in some setups counts as covered (R06: an agentshield policy; R40: `claude plugin validate` on the trigger). A tool where the problem shows only as something missing from a list counts as uncovered (R07, R09, R16, R36, R41). | **10 of 13 (77%)** | **met** |
| Every "partial" counts as uncovered (lenient) | 12 of 13 (92%) | met |

**Why the recorded reading.** The protocol asks whether a tool "would have caught that specific failure before it bit". A listing where a hook, agent or file is simply absent doesn't catch a *silent* failure. You have to already suspect it and go looking. The reporters had those built-in listings and were still hurt: R06's guard hooks ran disarmed for about 3 days.

## Agreement and resolutions

Two agents classified independently. They agreed on the exact class for 13 of 18 reports, and on detectable vs not for 15 of 18. Across all 28 reports, the figures are 22 of 28 and 24 of 28. The third reviewer resolved the disputes as follows (reasons are in `classification.json`):

| Report | A | B | Final | Short reason |
|---|---|---|---|---|
| R07 | D2 | D3 | D2 | The conflict is visible in the files whoever wrote it; first in rubric order |
| R08 | D3 | N2 | N2 | Conservative: a hook script, outside the checker's defined file scope |
| R18 | N2 | N1 | N2 | Subagent type not stated; not detectable either way |
| R36 | N2 | D3 | D3 | An installer added a hook to user settings, which a baseline comparison flags |
| R37 | D2 | N2 | D2 | The screenshot shows ask rules, and the docs say ask rules override a hook's allow (verified) |
| R28 | N1 | D1 | N1 | Secondary only. Cursor's docs say the config works in both, so this is a bug |

## What v0.1 would check

Per the protocol, v0.1 contains only checks that map to a classified report.

| Check | Class | Motivating report |
|---|---|---|
| An MCP server listed in both enabled and disabled lists (disabled wins) | D2 | R07 |
| A project settings file in an ancestor folder that isn't loaded | D2 | R09 |
| Allow rules that can't pre-approve writes to protected paths (`.claude/`, `.git`) | D2 | R10 |
| Unknown agent frontmatter keys, e.g. `allowed-tools` where `tools` is meant, silently ignored | D1 | R11 |
| An agent reference that doesn't resolve (plugin agents are namespaced) | D2 | R12 |
| A wrongly typed agent field (`hooks: []`) that drops the agent | D1 | R16 |
| Hooks added, removed or changed since the last-seen baseline | D3 | R36; also R06, R40 |
| Ask rules that override a hook's allow decision | D2 | R37 |
| Single-slash path anchors in permission rules | D2 | R39 |
| Nested CLAUDE.md files that load only when files in that folder are read | D2 | R41 |

Already caught by other tools (v0.1 would not duplicate): invalid settings JSON (R04: `claude doctor`, settings-effective).

## Secondary: the other 10 reports (Codex, Copilot, Cursor)

3 of 10 are detectable: R21 and R22 (Codex) and R33 (Cursor). The rest are runtime bugs or lack detail. This supports starting with Claude Code, with little case yet for other products.

## Threats and limits

**Platform catch-up.** Claude Code already warns on some documented mistakes, such as deny or ask rules naming unknown tools, and `claude doctor` flags invalid settings. Each release could absorb checks from this list.

**Adjacent tools:**
- settings-effective is 8 days old, has 1 star, and covers settings provenance. It is a candidate to contribute to or align with.
- agentshield has traction and could add these checks. Coverage also found it *misreads* R11: it treats `allowed-tools` in an agent file as an allowlist.

**Limits:**
- A small, targeted sample (18).
- Both classifiers are agents built on the same model family.
- Coverage was judged from docs and source only, not hands-on.
- The G2 reading is a judgment call, recorded above.
