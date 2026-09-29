# Option C test protocol: "Does my agent config actually apply?"

Pre-registered on 2026-09-27, before any classification. The first evidence sprint (`../evidence-sprint/`) said no-go for the planned diff tool. It found the larger pain was config that silently doesn't apply, and not knowing what's in effect. This test decides, by **2026-10-04**, whether to build a checker for that. Thresholds and rubric may change once, before classification starts, with the change recorded under "Amendments".

## The candidate: `context-canvas check`

A local, deterministic checker for Claude Code configuration that tells a person or an agent **what will actually apply, and what won't**:
- **Won't load:** parse and schema errors, unknown keys, invalid values, misplaced files.
- **Won't apply as intended:** scope and precedence, load conditions, path anchoring, matchers that never match, references to things that don't exist.
- **Changed without notice:** entries dropped or rewritten since the last committed or last-seen baseline.
- **Advisory, not enforced:** rules declared in instruction files that nothing enforces.

It would run as a CLI, a Claude Code hook and a CI step.

## Sample

The **28 reports** tagged C1 (can't tell what's in effect) or C5 (silent invalid config) in `../evidence-sprint/voice-of-user/quotes.json`, as verified on 2026-09-27.
- **Primary analysis:** the **18** that concern Claude Code: R02, R04, R06, R07, R08, R09, R10, R11, R12, R13, R16, R17, R18, R36, R37, R39, R40, R41.
- **Secondary analysis:** the other 10 (Codex, Copilot, Cursor). These inform later expansion only.

## Rubric: could a checker reading config files have caught it before it bit?

Each report gets exactly one class:

| Class | Meaning | Counts as detectable |
|---|---|---|
| D1 structural | The cause is visible in the files as a malformed file or schema violation: parse error, unknown key, invalid value, wrong filename or location | Yes |
| D2 documented semantics | The files are well-formed, but documented behavior means they won't apply as the user expects: scope and precedence, load conditions, path anchoring, matchers, missing references. **The rationale must cite the docs** (code.claude.com, as of 2026-09-27). Also record whether the rule is version-specific. | Yes |
| D3 drift | A tool or agent removed or rewrote config. A checker that compares against a committed or last-seen baseline would flag it on its next run. | Yes |
| N1 runtime | The files are correct and the docs say they should work, but the product misbehaved (a bug). A static checker can't see it. | No |
| N2 unknown | The report doesn't give enough information to classify it | No |

**Coverage:** for each report, would an existing tool have caught that specific failure before it bit?
- The tools:
  - Claude Code built-ins: `/doctor`, `claude plugin validate`, `/status`, `/permissions`, `/hooks`, `/mcp`, `/memory`, `/context`
  - settings-effective, skill-rollcall and mcp-rollcall
  - agentshield
  - agent-assurance
- Record *covered*, *partial* or *not covered*, citing the doc, README or source file.
- Judged from docs and source code only. No third-party packages are installed.

## Method

- **Two independent classifications.** Two agents classify all 28 reports separately, using this rubric and without seeing each other's work.
- **Resolving disagreements.** A third reviewer settles disagreements and writes down the reason for each. Agreement between the two agents is reported.
- **Coverage** is assessed by a separate agent.
- **Outputs** go in `classification.json`, `coverage.json` and `summary.md`.

## Go or no-go (on the 18 Claude Code reports)

**Go** requires all three:

| ID | Test | Threshold |
|---|---|---|
| G1 | Detectable (D1 + D2 + D3) | ≥ 9 of 18 (50%) |
| G2 | Detectable **and** not covered by any existing tool | ≥ 50% of the detectable reports |
| G3 | Breadth: the detectable, uncovered reports span distinct failure mechanisms | ≥ 3 mechanisms |

**If go:** v0.1 of the checker includes only checks that map to classified reports. Each check cites the report that motivates it.

**If no-go:** publish the result alongside the first findings. Do not build.

## Amendments

None.
