# H1 search log

Collected on 2026-09-27, in one session from about 06:58 to 07:55 CDT (11:58 to 12:55 UTC). All times below are CDT. This follows "H1: voice-of-user mining" in [../protocol.md](../protocol.md): the sources listed there, posts dated 2026-01-01 to 2026-09-27, categories C1 to C5, and the independence rules.

## Result

- **41 reports accepted** in [quotes.json](quotes.json). All 41 are independent: 41 different authors, with no vendor staff, bots, "+1"s, or posts by the Context Canvas author.
- **`check-quotes.mjs` verified 41 of 41** on 2026-09-27, run without a GitHub token.
- **Accepted by source:**

| Source | Reports |
|---|---|
| anthropics/claude-code issues | 18 |
| openai/codex issues | 5 |
| GitHub Copilot community discussions | 4 |
| forum.cursor.com | 6 |
| Hacker News | 3 |
| Reddit r/ClaudeCode | 3 |
| Reddit r/ClaudeAI | 2 |
| Reddit r/cursor | 0 |
| fmslutions/harness-audit | 0 |
| Adam-S-Daniel/claude-memory-map | 0 |

- **Categories.** A report can carry more than one category.

| Category | Reports tagged | Reports where it is listed first |
|---|---|---|
| C1 effective config | 12 | 6 |
| C2 agent-edited config | 18 | 14 |
| C3 capability creep | 10 | 9 |
| C4 review difficulty | 3 | 2 |
| C5 silent invalid config | 23 | 10 |

- **32 near-misses rejected**, each with a reason, in [rejected.json](rejected.json).
- **Collection stopped at about 40** under the stop rule. The sources were not exhausted; see "Valid candidates not recorded".

## Method

- **Text came from APIs, not from summaries.**
  - GitHub issues: REST search (`search/issues`) and issue endpoints, through an authenticated `gh`.
  - GitHub Discussions: GraphQL search and fetch.
  - forum.cursor.com: Discourse `search.json` and `/t/<id>.json`.
  - Hacker News: the Algolia search and items APIs.
  - Reddit: RSS feeds (see "Access problems").
  - WebFetch and WebSearch were not used: WebFetch returns a model's summary of a page, not its text.
- **Quotes are cut, not typed.** Each quote was cut out of the saved raw text by a start and an end phrase. Whitespace runs were collapsed to one space. Markdown characters (backticks, `**`) are kept as they appear in the source.
- **Two checks.**
  - The build step checks each quote against the saved raw text, with the same normalization as `check-quotes.mjs`. It also rejects quotes over 300 characters and dates outside the window.
  - `check-quotes.mjs` then fetches every URL live.
  - Negative control: four altered quotes on real URLs (GitHub issue, discussion, Cursor, HN) all returned NOT FOUND. The GraphQL discussion route was also tested with a token.
- **Dates** are the creation dates, in UTC, of the post or comment quoted.
- **Authors** are the account names shown on the source.
  - GitHub `author_association` was checked for every GitHub report. All are NONE except openai/codex#13386, which is CONTRIBUTOR.
  - Cursor posts were checked for the staff flag. No accepted post is by staff.
  - Each accepted Reddit post was read in full for links and promotion.
- **What was excluded:**
  - Posts where the model read CLAUDE.md, AGENTS.md or instructions and did not follow them. That is instruction adherence, not configuration that was ignored, changed, broadened or unreviewable. There are many such posts, especially on GitHub and HN.
  - Anticipated or hypothetical problems.
  - "+1" replies.
  - Vendor staff.
  - Bots.
  - Tool announcements ("Show HN", "I built ...").
  - Maintainer notes in tool repositories.
  - Posts whose author launched a related product around the same time.

## Queries

All GitHub queries had `created:2026-01-01..2026-09-27` appended. Totals are the counts the API reported. Totals for unquoted words are inflated by GitHub's loose matching; they are recorded, not interpreted. Titles were screened from up to 100 results per query (50 for discussions). Promising items were opened and read.

### anthropics/claude-code (issues)

| Time | Query | Total |
|---|---|---|
| 07:01 | `repo:anthropics/claude-code is:issue "modified settings.json"` | 43 |
| 07:01 | `repo:anthropics/claude-code is:issue "edited settings.json"` | 42 |
| 07:01 | `repo:anthropics/claude-code is:issue "settings.local.json" added without asking` | 52 |
| 07:01 | `repo:anthropics/claude-code is:issue "modified its own" settings` | 11 |
| 07:01 | `repo:anthropics/claude-code is:issue "edited its own"` | 17 |
| 07:01 | `repo:anthropics/claude-code is:issue "overwrote" CLAUDE.md` | 34 |
| 07:01 | `repo:anthropics/claude-code is:issue CLAUDE.md "without asking" modified` | 55 |
| 07:01 | `repo:anthropics/claude-code is:issue "deleted my hooks" OR "removed my hooks" OR "removed the hook"` | 99 |
| 07:03 | `repo:anthropics/claude-code is:issue subagent tools frontmatter ignored` | 91 |
| 07:03 | `repo:anthropics/claude-code is:issue "allowed-tools" ignored skill` | 40 |
| 07:03 | `repo:anthropics/claude-code is:issue "disallowedTools" ignored` | 34 |
| 07:03 | `repo:anthropics/claude-code is:issue frontmatter "silently" agent` | 435 |
| 07:03 | `repo:anthropics/claude-code is:issue skill frontmatter "silently"` | 380 |
| 07:04 | `repo:anthropics/claude-code is:issue ".mcp.json" "not loaded" OR "not loading" OR "ignored"` | 1071 |
| 07:04 | `repo:anthropics/claude-code is:issue enabledMcpjsonServers` | 74 |
| 07:13 | `repo:anthropics/claude-code is:issue subagent "all tools" restriction` | 50 |
| 07:13 | `repo:anthropics/claude-code is:issue "deny" rule bypassed` | 178 |
| 07:13 | `repo:anthropics/claude-code is:issue "broader than" permission` | 140 |
| 07:13 | `repo:anthropics/claude-code is:issue plugin hooks "without" consent OR notice OR approval` | 1038 |
| 07:13 | `repo:anthropics/claude-code is:issue "Bash(*)"` | 12610 |
| 07:13 | `repo:anthropics/claude-code is:issue "additionalDirectories"` | 239 |
| 07:13 | `repo:anthropics/claude-code is:issue "too permissive" OR "overly broad" permission` | 11895 |

### openai/codex (issues)

| Time | Query | Total |
|---|---|---|
| 07:04 | `repo:openai/codex is:issue config.toml ignored` | 266 |
| 07:04 | `repo:openai/codex is:issue AGENTS.md "not" loaded OR ignored OR "not read"` | 683 |
| 07:04 | `repo:openai/codex is:issue "silently" config` | 1016 |
| 07:04 | `repo:openai/codex is:issue approval_policy OR sandbox_mode ignored` | 832 |
| 07:04 | `repo:openai/codex is:issue mcp_servers not loading OR ignored` | 110 |
| 07:04 | `repo:openai/codex is:issue codex modified config.toml OR "edited config" OR "changed my config"` | 1268 |
| 07:05 | `repo:openai/codex is:issue "which config" OR "effective config" OR precedence profile` | 2670 |
| 07:05 | `repo:openai/codex is:issue skills SKILL.md not loaded OR ignored OR silently` | 291 |

### GitHub Copilot: community/community (discussions, GraphQL search)

| Time | Query | Total |
|---|---|---|
| 07:05 | `repo:community/community is:discussion copilot-instructions.md ignored` | 19 |
| 07:05 | `repo:community/community is:discussion copilot instructions "not applied" OR "not being used" OR "ignored"` | 291 |
| 07:06 | `repo:community/community is:discussion copilot agent mcp configuration "not" working` | 28 |
| 07:06 | `repo:community/community is:discussion copilot AGENTS.md` | 19 |
| 07:06 | `repo:community/community is:discussion copilot "applyTo"` | 10 |
| 07:06 | `repo:community/community is:discussion copilot agent modified settings OR "changed my settings" OR "edited my"` | 39 |
| 07:06 | `repo:community/community is:discussion copilot coding agent permissions firewall` | 9 |

### fmslutions/harness-audit and Adam-S-Daniel/claude-memory-map

- **harness-audit.** `fmslutions/harness-audit` redirects to `fabianmartinelli-fm/harness-audit`.
  - It has 4 issues, all by the owner: three "Results" posts about their own tool, and a release note (issue 3, judged from its title).
  - It has no PRs. Discussions are off, and a discussion search at 07:09 returned 0.
- **claude-memory-map.** It has 6 issues and 43 PRs.
  - Five issues are by the owner: changelog-tracking notes, a Dependabot problem and a suggestion. One is a bot sweep.
  - A discussion search at 07:09 returned 0.
- Neither repository held an independent user report. The issues read are in `rejected.json`.

### forum.cursor.com (Discourse search, each with `after:2026-01-01 before:2026-09-28`)

| Time | Query | Posts returned |
|---|---|---|
| 07:07 | `rules not applied` | 50 |
| 07:07 | `cursor rules ignored` | 50 |
| 07:07 | `alwaysApply` | 50 |
| 07:07 | `mcp.json not loading` | 48 |
| 07:07 | `AGENTS.md ignored` | 36 |
| 07:08 | `agent modified my rules` | 50 |
| 07:08 | `agent edited .cursor` | 50 |
| 07:08 | `agent changed settings.json` | 50 |
| 07:08 | `hooks.json not running` | 38 |
| 07:08 | `allowlist ignored` | 50 |
| 07:08 | `cli-config.json` | 34 |
| 07:08 | `agent deleted rule` | 50 |
| 07:08 | `which rules are applied` | 50 |
| 07:08 | `auto-run allowlist` | 50 |

Topics opened: 158521, 171139, 171733, 154223, 157484, 158551, 167431, 160343, 166558, 160199.

### Hacker News (Algolia; `created_at_i` from 2026-01-01 to before 2026-09-28; comments and stories)

| Time | Query | Comments | Stories |
|---|---|---|---|
| 07:10 | `claude settings.json` | 123 | 16 |
| 07:10 | `CLAUDE.md ignored` | 71 | 12 |
| 07:10 | `claude code hooks` | 1306 | 387 |
| 07:10 | `added to allow list` | 56 | 12 |
| 07:10 | `dangerously-skip-permissions` | 215 | 39 |
| 07:10 | `Check your Claude settings` | 38 | 20 |
| 07:10 | `AGENTS.md only when telemetry` | 0 | 2 |
| 07:10 | `settings.local.json` | 12 | 0 |
| 07:10 | `permissions.deny` | 4 | 0 |
| 07:10 | `edited its own settings` | 3 | 1 |
| 07:10 | `modified my CLAUDE.md` | 1 | 0 |
| 07:10 | `codex config.toml` | 19 | 4 |
| 07:10 | `cursor rules not applied` | 0 | 1 |
| 07:10 | `hook silently` | 75 | 36 |
| 07:11 | `settings.json overwritten` | 0 | 0 |
| 07:12 | `hooks not firing` | 254 | 29 |
| 07:12 | `allow list too broad` | 6 | 2 |
| 07:12 | `which MCP servers` | 537 | 260 |
| 07:12 | `AGENTS.md codex ignored` | 28 | 4 |
| 07:12 | `claude code permissions ignored` | 3 | 9 |
| 07:12 | `memory claude wrong` | 94 | 28 |

Items opened: 49565799, 46691649, 47668586, 47805197, 49760765, 48682833, 49814947 (and its replies), 47895029.

### Reddit (RSS; r/ClaudeAI, r/ClaudeCode, r/cursor)

Access probes, 07:00 to 07:12:
- `www.reddit.com/r/ClaudeAI/search.json` returned 403 with three different user agents.
- `old.reddit.com/.../search.json` redirected to a login page.
- `api.reddit.com/...` returned 403.
- `/r/ClaudeAI/new/.rss` returned 200.
- `/r/ClaudeAI/search.rss?q=settings.json+permissions&sort=new&t=year` returned 429, then 200 after a pause (25 results).
- A thread `.rss` requested right after returned 429.

Paced requests (35 to 70 s apart). Searches used `restrict_sr=on&sort=relevance&t=year`; results before 2026-01-01 were discarded.

| Time | Request | Result |
|---|---|---|
| 07:12 | search r/ClaudeAI: `settings.json permissions` | HTTP 200, 25 results |
| 07:13 | search r/ClaudeCode: `settings.json` | HTTP 200, 25 results |
| 07:14 | search r/ClaudeAI: `edited CLAUDE.md` | HTTP 200, 25 results |
| 07:16 | search r/ClaudeCode: `CLAUDE.md changed` | HTTP 200, 25 results |
| 07:18 | search r/ClaudeCode: `hooks not working` | HTTP 200, 25 results |
| 07:20 | thread r/ClaudeCode/1wb1wrg | HTTP 200, 80 entries |
| 07:21 | thread r/ClaudeCode/1stsey3 | HTTP 200, 2 entries |
| 07:22 | thread r/ClaudeCode/1qtblh4 | HTTP 200, 14 entries |
| 07:23 | thread r/ClaudeCode/1rmcyp7 | HTTP 200, 1 entries |
| 07:24 | search r/cursor: `rules ignored` | HTTP 200, 25 results |
| 07:26 | thread r/ClaudeAI/1srdnp0 | HTTP 200, 54 entries |
| 07:27 | thread r/ClaudeCode/1sos8hm | HTTP 200, 4 entries |
| 07:28 | search r/cursor: `mcp.json` | HTTP 200, 25 results |
| 07:29 | thread r/ClaudeAI/1wgjrje | HTTP 200, 5 entries |
| 07:30 | thread r/ClaudeAI/1wj7v4y | HTTP 200, 7 entries |
| 07:31 | search r/cursor: `allowlist permissions` | HTTP 200, 3 results |
| 07:33 | thread r/ClaudeCode/1tea15l | HTTP 200, 3 entries |
| 07:34 | thread r/ClaudeCode/1rn8nxf | HTTP 200, 3 entries |
| 07:35 | /user/junianwoo/submitted/.rss?limit=50 | HTTP 200, 49 entries |
| 07:37 | /r/cursor/comments/1tps1t3/.rss?limit=100 | HTTP 200, 10 entries |

## Access problems

- **Reddit's JSON API is blocked from this network.**
  - Search, listing and thread `.json` requests returned HTTP 403 or a login wall. Reddit was read through RSS instead.
  - RSS was rate-limited (HTTP 429) above about one request a minute, so requests were paced 35 to 70 s apart.
  - The planned list of 20 Reddit searches was cut to 8 (5 on r/ClaudeAI and r/ClaudeCode, 3 on r/cursor), plus 12 thread fetches and one user-history check. **Reddit is under-covered compared with the other sources.**
  - `check-quotes.mjs` tries `.json` first, as the brief asks. From this network it falls back to `.rss` for all 5 Reddit reports.
- **GitHub search** ran through an authenticated `gh`. Anonymous search is limited to 10 queries a minute.
  - The checker needs no token: GitHub issues use the REST API (60 anonymous requests an hour is enough here), and discussions use their HTML page.
  - With `GITHUB_TOKEN` set, the checker uses GraphQL for discussions.
- **No other source was inaccessible.** The GitHub, Discourse and Algolia APIs answered every request.
- **fmslutions/harness-audit** is now at fabianmartinelli-fm/harness-audit (redirect).

## Valid candidates not recorded

These were read and look like valid reports. They were left out to stay near 40, mostly because they duplicate a recorded report's mechanism or category. They count toward nothing and are listed for auditability.

| URL | Category | Note |
|---|---|---|
| https://github.com/anthropics/claude-code/issues/85416 | C1, C5 | Subagent effort level cannot be observed |
| https://github.com/anthropics/claude-code/issues/87217 | C5 | `paths:` on a user-level rule silently disables it |
| https://github.com/anthropics/claude-code/issues/17017 | C1 | Project permissions appear to replace global ones (issue ends with "Generated with Claude Code") |
| https://github.com/anthropics/claude-code/issues/44631 | C2, C5 | Running sessions strip a `hooks` key from settings.json |
| https://github.com/anthropics/claude-code/issues/46921 | C2, C5 | `/model` overwrote settings.json, losing statusLine and hooks |
| https://github.com/anthropics/claude-code/issues/65629 | C1 | `/permissions` reports success for rules that managed policy blocks (drafted with AI assistance) |
| https://github.com/anthropics/claude-code/issues/93109 | C5 | Unknown agent frontmatter keys are ignored without a warning |
| https://github.com/anthropics/claude-code/issues/21460 | C3, C5 | PreToolUse hooks not enforced for subagent tool calls |
| https://github.com/anthropics/claude-code/issues/95002 | C3, C5 | A Bash specifier in a subagent's `tools:` grants unrestricted Bash |
| https://github.com/anthropics/claude-code/issues/73158 | C5 | A UTF-8 BOM makes an agent file silently skipped |
| https://github.com/anthropics/claude-code/issues/78270 | C5 | An unquoted `: ` in a skill description silently drops the skill |
| https://github.com/anthropics/claude-code/issues/49834 | C5 | settings.json that becomes malformed mid-session is silently ignored |
| https://github.com/openai/codex/issues/14687 | C5 | Global AGENTS.md with a bad encoding is not loaded, with no warning |
| https://github.com/openai/codex/issues/45432 | C2, C5 | `codex mcp add` rewrites every MCP entry, dropping comments and unknown keys |
| https://forum.cursor.com/t/plugin-rules-with-alwaysapply-true-are-silently-downgraded-to-applied-intelligently/154223 | C5 | Same alwaysApply bug as the recorded pchalacis report, different author |
| https://forum.cursor.com/t/alwaysapply-true-rules-are-being-completely-ignored-now/158551 | C5 | alwaysApply rules not honored (RayGraham, opening post) |
| https://www.reddit.com/r/ClaudeCode/comments/1tea15l/claude_code_can_access_env_file_through_the_ide/ | C3 | A `.env` deny rule bypassed through IDE selection context |
| https://www.reddit.com/r/ClaudeCode/comments/1rn8nxf/some_hooks_not_working_in_claude_code/ | C5 | PreToolUse and PostToolUse hooks never fired |
| https://www.reddit.com/r/ClaudeAI/comments/1srdnp0/claude_code_silently_bypassed_two_layers_of/ohes7gn/ | C3 | Reply: Read deny rules did not cover `Bash(cat *)` |

The search result lists also held many more matching titles that were never opened. anthropics/claude-code and openai/codex alone have dozens of "silently ignored" and "silently dropped" configuration issues in the window.

## Caveats

- **The sample is purposive.** Searches targeted the five categories, so the counts show that these reports exist and how they spread across categories. They do not show how often the problems occur.
- **GitHub issue trackers dominate** (27 of 41). Their reports are the most searchable and the most detailed.
- **Some reporters used AI to draft their reports.** Two recorded issues say so (anthropics/claude-code#88800, and #65629 among those not recorded). One (#32376) refers to the reporter in the third person. They are counted because the reporter had the problem; `notes` says so where it applies.
- **C2 covers two kinds of change.** `notes` says which applies to each of the 18 C2 reports.
  - 7 are edits by the model or agent (Claude, the Codex agent, Copilot's agent).
  - 10 are rewrites or writes by the harness: an extension, `/model`, marketplace handling, background sessions, a settings panel, the approval flow, a product setting.
  - In 1 (R02) the reporter cannot tell who made the change.
- **Two C2 tags are suspected, not confirmed.** In R02 the reporter cannot tell who set the key. In R35 the poster believes Remote Control was enabled without consent but does not recall the prompt.
