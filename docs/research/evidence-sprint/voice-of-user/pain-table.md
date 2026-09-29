# H1 pain table

Collected on 2026-09-27 by agent-assisted desk research, from reports dated 2026-01-20 to 2026-09-17. Rules are in `../protocol.md`. The raw data is in `quotes.json`, near-misses are in `rejected.json`, and the queries are in `search-log.md`.

**41 reports, all independent** (41 distinct authors; no vendor staff, bots or "+1"s). The H1 threshold is 15. **Met.**

**Quote check:** `check-quotes.mjs` verified 41 of 41 against the live pages on 2026-09-27. A separate spot check with `gh api` confirmed 6 GitHub quotes, their authors and their dates. An altered quote was correctly not found.

## By category

A report can belong to several categories.

| Code | Category | Reports |
|---|---|---|
| C5 | Silent invalid config: ignored or broken with no clear error | 23 |
| C2 | Config changed unexpectedly | 18 |
| C1 | Can't tell what's in effect, or where it came from | 12 |
| C3 | Capability broader than intended | 10 |
| C4 | Couldn't review a config change | 3 |

**Who changed the config in the 18 C2 reports:**
- **Agent-initiated, 7:** R01, R03, R04, R19, R24, R37, R38.
  - An agent weakened an enforcement hook's trigger (R03).
  - An agent removed its own guardrails while testing a hook (R37).
  - An agent added a protective-looking setting that did nothing (R04).
  - Agents rewrote or added to CLAUDE.md unasked (R01, R38).
  - A Codex agent added `model_instructions_file` to the global config (R19).
- **Tool-initiated, 10:** R05, R06, R07, R20, R23, R30, R32, R34, R35, R40. In these, extensions, `/model`, approval flows, settings panels or plugin handling rewrote config, sometimes dropping hooks or wiping settings.
- **Unclear, 1:** R02 (suspected by the reporter).

**By source:**

| Source | Reports |
|---|---|
| anthropics/claude-code | 18 |
| openai/codex | 5 |
| forum.cursor.com | 6 |
| Copilot discussions | 4 |
| Reddit | 5 |
| Hacker News | 3 |

## Themes

1. **Config breaks or fails to load, and nothing says so** (C5, the largest group).
   - Frontmatter parse failures, settings files in parent folders, nested CLAUDE.md files in auto mode, truncated AGENTS.md, Cursor `alwaysApply`.
   - "Nothing fails and nothing warns you. Every command succeeds. You only notice when Claude breaks a rule you wrote down." ([Reddit](https://www.reddit.com/r/ClaudeAI/comments/1wj7v4y/in_auto_mode_your_nested_claudemd_files_are/))
   - "The result is a class of failure where every visible signal is green and enforcement is zero." ([claude-code#83952](https://github.com/anthropics/claude-code/issues/83952))
2. **Tools and agents rewrite config and drop guards** (C2).
   - "In my case that silently removed five `PreToolUse`/`PostToolUse` hook entries, which are security and verification guards. They ran disarmed for ~3 days across every session on the machine." ([claude-code#93742](https://github.com/anthropics/claude-code/issues/93742))
   - "the agent modified the **global** `~/.codex/config.toml` without an explicit request to add `model_instructions_file`." ([codex#41678](https://github.com/openai/codex/issues/41678))
3. **Restrictions don't hold under some modes or paths** (C3): auto mode, subagents, IDE context, allowlist parsing.
   - "The skill that invoked it ran with `Edit` and `Write` available for months of authoring without anyone noticing, because the output looked correct." ([claude-code#83133](https://github.com/anthropics/claude-code/issues/83133))
4. **Nobody can see what's in effect, or where it came from** (C1): which hook, rule or setting applies, from which file.
5. **Review difficulty is thin** (C4: 3 reports). People rarely describe failing to *review* a change. They describe changes they never saw, or config that silently didn't apply.

## Caveats

- **Targeted, not a frequency estimate.** The search looked for these categories, so the sample shows the problems exist, not how common they are.
- **Heavy on GitHub (27 of 41).** Reddit is under-covered: it blocks JSON from this network, and the RSS fallback is rate-limited.
- **Not exhausted.** Collection stopped at about 40. `search-log.md` lists 19 more valid reports that were left out.
- **Two C2 tags are suspicions**, not confirmed by the reporters.
