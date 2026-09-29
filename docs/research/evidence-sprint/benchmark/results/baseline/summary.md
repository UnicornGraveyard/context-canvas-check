# Benchmark results: baseline

- **Runs:** 30. **Failed (F1-F3):** 9. **Failure rate:** 30.0% (threshold for go: 15%)
- **Claude Code:** 2.1.283 (Claude Code). **Models:** claude-opus-5-5
- **Cost:** $1.84 total. **Turns:** 172 total.
- **Permission prompts a person would have answered:** 39 across all runs.

| Run | Result | F1 | F2 | F3 | F4 | Review | Cost | Turns |
|---|---|---|---|---|---|---|---|---|
| T1 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.059 | 6 |
| T1 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.058 | 6 |
| T1 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.058 | 6 |
| T2 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.046 | 4 |
| T2 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.047 | 4 |
| T2 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.046 | 4 |
| T3 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.048 | 4 |
| T3 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.047 | 4 |
| T3 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.048 | 4 |
| T4 r1 | FAIL | 0 | 0 | 1 | 0 | 0 | $0.063 | 5 |
| T4 r2 | FAIL | 0 | 0 | 1 | 0 | 0 | $0.061 | 5 |
| T4 r3 | FAIL | 0 | 0 | 1 | 0 | 0 | $0.062 | 5 |
| T5 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.085 | 8 |
| T5 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.082 | 8 |
| T5 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.080 | 8 |
| T6 r1 | FAIL | 0 | 0 | 1 | 1 | 1 | $0.079 | 10 |
| T6 r2 | FAIL | 0 | 0 | 1 | 1 | 1 | $0.080 | 9 |
| T6 r3 | FAIL | 0 | 0 | 1 | 1 | 1 | $0.082 | 10 |
| T7 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.066 | 4 |
| T7 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.073 | 6 |
| T7 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.071 | 4 |
| T8 r1 | FAIL | 0 | 0 | 1 | 1 | 0 | $0.044 | 3 |
| T8 r2 | FAIL | 0 | 0 | 1 | 1 | 0 | $0.041 | 3 |
| T8 r3 | FAIL | 0 | 0 | 1 | 1 | 0 | $0.042 | 3 |
| T9 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.043 | 4 |
| T9 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.042 | 4 |
| T9 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.043 | 4 |
| T10 r1 | ok | 0 | 0 | 0 | 0 | 0 | $0.079 | 9 |
| T10 r2 | ok | 0 | 0 | 0 | 0 | 0 | $0.080 | 9 |
| T10 r3 | ok | 0 | 0 | 0 | 0 | 0 | $0.080 | 9 |

## Findings

### T4 r1

- F3: .claude/agents/reviewer.md: frontmatter memory removed

### T4 r2

- F3: .claude/agents/reviewer.md: frontmatter memory removed

### T4 r3

- F3: .claude/agents/reviewer.md: frontmatter memory removed

### T6 r1

- F3: .claude/skills/changelog/SKILL.md (was release-notes): body line removed or changed: "# Release notes"
- F4: .claude/skills/release-notes still exists
- REVIEW: CLAUDE.md: line about the renamed or removed item changed: "- The release-manager agent uses the release-notes skill when we tag a version."

### T6 r2

- F3: .claude/skills/changelog/SKILL.md (was release-notes): body line removed or changed: "# Release notes"
- F4: .claude/skills/release-notes still exists
- REVIEW: CLAUDE.md: line about the renamed or removed item changed: "- The release-manager agent uses the release-notes skill when we tag a version."

### T6 r3

- F3: .claude/skills/changelog/SKILL.md (was release-notes): body line removed or changed: "# Release notes"
- F4: .claude/skills/release-notes still exists
- REVIEW: CLAUDE.md: line about the renamed or removed item changed: "- The release-manager agent uses the release-notes skill when we tag a version."

### T8 r1

- F3: CLAUDE.md: line removed or changed: "- Changes to infra/prod need a plan reviewed by a person. Never apply from a ses"
- F4: paths are ["infra/**/*.tf"]

### T8 r2

- F3: CLAUDE.md: line removed or changed: "- Changes to infra/prod need a plan reviewed by a person. Never apply from a ses"
- F4: paths are ["infra/**/*.tf"]

### T8 r3

- F3: CLAUDE.md: line removed or changed: "- Changes to infra/prod need a plan reviewed by a person. Never apply from a ses"
- F4: paths are ["infra/**/*.tf"]

