# H3 competitive teardown

Protocol: [protocol.md](protocol.md), section "H3: competitive teardown". Collected on 2026-09-27. H3 shapes the scope of v0.1. It is not a go condition.

> **H3.** Existing tools don't show risk-labeled, semantic changes to agent configuration where review happens.

## Summary

- **H3 does not hold for permission rules and MCP servers. It still holds for the rest of the Claude Code surface.** At least six deterministic tools report risk-labeled changes between two versions of agent configuration: agent-assurance, agent-pr-reviewer-lite, agent-permission-diff, MONNA agent-permission-diff, agent-permission-diff-bot and agentcapdiff. All six run in CI on pull requests, and two post a PR comment. All six started between June and September 2026, and none has more than 3 GitHub stars.[^42]
- **agent-assurance already does the core diff well** for `.mcp.json` and Claude Code permission rules. It keeps one PR comment current on every push, shows the change in blast radius (for example LOW → HIGH) and fails a check. A Claude Code hook and an MCP tool warn the agent during the edit. It doesn't read subagent frontmatter, hooks or skills.
- **The strongest alternative overall is agentshield.** It has 1,229 stars, about 37,000 npm downloads last month[^47], and 268 rules over permissions, hooks, MCP servers and agent files. It also has a baseline drift gate with PR annotations and an auto-fix that rolls itself back. Its diff compares findings, not capabilities.
- **Effective config is partly covered.** Claude Code's own views show runtime state for each surface, and `/permissions` names the file behind every rule. The docs say `/status` "doesn't show which file supplied each key". settings-effective (created 2026-09-19) fills that for settings. No tool shows a whole project before merge, per agent, in plain language.
- **Deterministic editing is partly covered.** Generators cover it (rulesync, ruler), and so do native typed commands (`claude mcp add` and `remove`, `/permissions`, plugin enable and disable) and agentshield `--fix`. `ant apply` has plan, approve and apply, but only for Managed Agents API resources.
- **The gate enforcement map is uncovered.** Tools that ship their own gates say which of those gates are enforced (speckit-gate, specforge, Looper). agent-assurance checks one case: a declared "a human approves" promise against `allow` rules. Nothing maps an existing project's declared gates to hooks, permission rules or CI.

## Method

- **Sources.** Official docs, READMEs, changelogs and repository metadata, all accessed on 2026-09-27. Stars and creation dates come from the GitHub API that day. npm downloads cover 2026-08-28 to 2026-09-26 and can include automated traffic.
- **Hands-on, Claude Code.** The local CLI is 2.1.143 (released 2026-05-15). The docs and changelog describe 2.1.283 (2026-09-25). Where the two differ, the matrix follows the current docs and the footnote names the version.
  - Commands run: `claude --version`, `claude plugin validate` on the Context Canvas plugin export and on probe fixtures, `claude mcp list` and `claude mcp get` in a temporary project, `claude plugin details`, and `claude auto-mode config`.
  - Probes lived in a scratch directory. No real configuration was changed. See the [hands-on log](#hands-on-log).
- **Not run.**
  - Slash commands: this session was non-interactive.
  - `ant apply`: no Managed Agents workspace.
  - The GitHub validator: it needs an enterprise account.
  - Every third-party tool: the sprint rules forbid installing them.

  Those rows come from docs and READMEs. One comparison cited below was executed by a competitor, and it is labeled that way.

### How to read the matrix

Ratings are relative to the whole Claude Code project surface: settings and permission rules, hooks, subagents, skills, MCP servers, and instruction files (CLAUDE.md, AGENTS.md, rules).

- **✓**: does it for most of that surface.
- **partial**: does it for some surfaces, or only weakly (at file level, as findings, or through an LLM), or for another product's resources.
- **✗**: doesn't do it.

The columns:

- **Effective config (scopes)**: shows what applies after scopes merge, and where each part came from. The cell names the scopes.
- **Plain-language explanation**: says in prose what the configuration or a change allows.
- **Semantic diff**: compares two versions (git refs or a baseline) by keys, rules or capabilities, not by lines.
- **Risk labels**: severity or risk attached to the configuration or to a change.
- **Deterministic edit**: typed, reproducible edits with a dry run or plan that leave unrelated content alone.
- **Gate enforcement map**: maps declared gates or approval points to what enforces them, and flags the advisory ones.
- **Agent interface**: how an agent can call it and get structured output.
- **Review surface**: where results appear. PR, local, or in-host (inside the agent session).

## Capability matrix

### Matrix: Claude Code built-ins

| Tool | Effective config (scopes) | Plain-language explanation | Semantic diff | Risk labels | Deterministic edit | Gate enforcement map | Agent interface | Review surface |
|---|---|---|---|---|---|---|---|---|
| `/permissions` | partial: every permission rule and the file it comes from, all scopes[^1] | ✗ | ✗ | ✗ | partial: add or remove rules and directories, interactive[^1] | ✗ | ✗ | in-host |
| `/mcp`, `claude mcp` | partial: every server with status and approval; `get` names its scope[^2] | ✗ | ✗ | ✗ | partial: `claude mcp add` and `remove` with `-s <scope>`[^2] | ✗ | CLI (text) | local, in-host |
| `/agents` | ✗: since 2.1.198 it only prints a reminder[^3] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | in-host |
| `/memory` | partial: CLAUDE.md and memory file locations, user and project[^4] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | in-host |
| `/hooks` | partial: hooks registered this session, by event[^5] | partial: one-sentence notices (2.1.281)[^5] | ✗ | ✗ | ✗ | ✗ | ✗ | in-host |
| `/status` | partial: settings files loaded and the managed source; not which file set each key[^6] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | in-host |
| `/doctor`, `claude doctor`, `prompt-audit` | partial: rejected entries, servers defined in several scopes, duplicate agent names[^7] | partial: LLM-written findings[^7] | ✗ | ✗ | ✗: an LLM applies fixes after you confirm[^7] | ✗ | CLI (text) | local, in-host |
| `/context` | partial: what loaded, including subagents with their source, memory files, skills, MCP tools[^8] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | in-host |
| `claude auto-mode config`, `critique` | partial: auto mode classifier rules only[^9] | partial: `critique` is LLM feedback[^9] | ✗ | ✗ | ✗ | ✗ | CLI (JSON) | local |
| `claude plugin validate`, `details` | partial: `details` lists one plugin's components and token cost[^10] | ✗ | ✗ | partial: errors and warnings, few security checks[^11] | ✗ | ✗ | CLI (`--json` since 2.1.259)[^10] | local, CI (exit code) |
| Managed and server-managed settings | partial: `/status` names the managed source; an OTel event for fleets[^12] | partial: approval dialog explains risky delivered settings[^13] | ✗ | partial: a fixed list of settings that need user approval[^13] | ✗: JSON in the console, validated on a test machine[^14] | ✗ | ✗ | in-host dialog, admin console |
| Protected paths, workspace trust, `ConfigChange` hook | partial: trust dialog lists the allow rules and directories a repository would grant[^15] | partial: the same dialog[^15] | ✗: `ConfigChange` passes source and file path only[^16] | partial: path level; agent writes to `.claude/` and `.mcp.json` prompt[^17] | ✗ | ✗ | hook API | in-host |
| Code Review (`@claude review`), research preview | ✗ | ✓: LLM prose | partial: an LLM reads the PR diff; config focus only if `REVIEW.md` asks for it[^18] | partial: Important, Nit, pre-existing[^18] | ✗ | ✗ | ✗ | PR: inline comments, check run |

### Matrix: other vendors

| Tool | Effective config (scopes) | Plain-language explanation | Semantic diff | Risk labels | Deterministic edit | Gate enforcement map | Agent interface | Review surface |
|---|---|---|---|---|---|---|---|---|
| `ant apply` (Managed Agents) | partial: lockfile and drift detection, API resources only[^19] | ✗ | partial: field-by-field update diff in the plan[^19] | ✗ | partial: plan, approve, apply; API resources, not local files[^19] | ✗ | CLI (`--dry-run`, `--yes`) | local; PR only as CI log output[^20] |
| GitHub Copilot managed-settings validator | ✗: no developer view documented[^21] | ✗ | ✗ | ✗: structural errors with file and JSON path[^21] | ✗ | ✗ | ✗ | admin page, after a commit to the default branch[^21] |

### Matrix: third-party tools named in the protocol

| Tool | Effective config (scopes) | Plain-language explanation | Semantic diff | Risk labels | Deterministic edit | Gate enforcement map | Agent interface | Review surface |
|---|---|---|---|---|---|---|---|---|
| rulesync | ✗ | ✗ | ✗: `--dry-run` lists files; `--check` fails CI on stale output[^22] | ✗ | partial: generates Claude rules, commands, subagents, skills, hooks, permissions and MCP from `.rulesync/`[^22] | ✗ | CLI, MCP | local, CI |
| ruler | ✗ | ✗ | ✗: `--dry-run` preview[^23] | ✗ | partial: apply and revert with backups; no permissions or hooks[^23] | ✗ | CLI | local |
| Looper | ✗ | partial: `LOOP.md` for its own loop spec[^24] | ✗ | ✗ | ✗ | partial: its own gates; marks its budget caps advisory[^24] | skill, `looper lint --json` | in-host, local, CI |
| harness-audit | partial: loaded context per agent across managed, user, project and local; no permissions[^25] | partial: LLM-written plan and report[^25] | ✗: before and after token counts only | partial: plan items grouped Low, Medium, High; lint codes[^25] | partial: scripted sync and lint; `apply` on a branch after approval[^25] | ✗ | skill, `lint.py --json` | in-host, local, pre-commit, CI |
| claude-memory-map | ✗: a generic map with no user configuration[^26] | partial: plain labels for each memory store, generic[^26] | ✗ | ✗ | ✗ | ✗ | ✗ | web page |

### Matrix: found by search

| Tool | Effective config (scopes) | Plain-language explanation | Semantic diff | Risk labels | Deterministic edit | Gate enforcement map | Agent interface | Review surface |
|---|---|---|---|---|---|---|---|---|
| agentshield | partial: scans `~/.claude` and the project; tags each finding's runtime source[^27] | partial: HTML report, optional Opus analysis[^27] | partial: baseline drift of findings and score[^28] | ✓: 268 rules, severities, A to F grade[^27] | partial: `--fix` with re-scan and rollback[^29] | ✗ | CLI (JSON, SARIF), plugin | PR: annotations, job summary, SARIF; local |
| agent-assurance | partial: grants in `.mcp.json` and Claude permission rules; no agents, hooks or skills[^30] | partial: PR comment sentences, HTML capability card[^30] | partial: base against head, change in blast radius; MCP and permissions[^31] | partial: blast-radius bands, OWASP mapping; same scope[^30] | ✗ | partial: declared "human approves" against `allow` rules[^30] | CLI, MCP server, Claude Code hook[^31] | PR comment and check, SARIF, in-host |
| agent-pr-reviewer-lite | ✗ | partial: templated reasons, `--explain`[^32] | partial: paths and added lines between refs; names risky keys added[^32] | ✓: high and medium rules for settings, hooks, MCP and agent files[^32] | ✗ | ✗ | CLI (JSON, SARIF, JUnit) | PR comment, annotations; local |
| agent-permission-diff | partial: best-effort Claude, Codex and Cursor permissions with source and confidence[^33] | partial: `explain <n>`[^33] | partial: broadened capabilities against a committed baseline[^33] | partial: severity per change | ✗ | ✗ | CLI, library | local, CI (SARIF) |
| MONNA agent-permission-diff | ✗: "not an effective-permission evaluator"[^34] | partial: reasons and suggested actions | partial: Claude permission keys and MCP JSON, including removals[^34] | partial: low, medium, high | ✗ | ✗ | CLI (JSON, SARIF) | CI job summary, browser, local |
| agent-permission-diff-bot, agentcapdiff | ✗ | partial | partial: MCP configs, GitHub Actions permissions and instructions; tool definitions[^35] | partial | ✗ | ✗ | CLI | CI (SARIF), local |
| ruleblast | partial: the instruction stack each file inherits, for four agents[^36] | partial: `explain` names the source chain[^36] | partial: git-ref diff of instruction inheritance[^36] | ✗ | ✗ | ✗ | CLI (`--json`) | local, VS Code |
| settings-effective, skill-rollcall, mcp-rollcall | partial: every settings key and the file that set it (managed file, `--settings`, local, project, user) plus trust; skills and MCP through the siblings; no subagents[^37] | partial: findings in sentences, `--explain KEY`[^37] | ✗ | ✗: findings are about applicability, not risk | ✗: read-only | ✗ | skill, CLI (`--json`, `--strict`) | in-host, local, CI |
| Snyk agent-scan | partial: finds MCP servers and skills across agents[^38] | ✗ | ✗[^38] | partial: risk indicators for MCP servers and skills | ✗ | ✗ | CLI (`--ci`) | local, CI |
| claudelint | ✗ | ✗ | ✗ | partial: lint severities for settings, hooks, MCP, CLAUDE.md, skills and plugins[^39] | partial: `--fix`[^39] | ✗ | CLI, plugin | local, CI (SARIF) |
| speckit-gate, specforge | ✗ | ✗ | ✗ | ✗ | ✗ | partial: say which of their own gates deny, only advise, or do nothing, per agent[^40] | CLI, plugin | in-host (hooks) |

## What each tool does for config review

### Claude Code built-ins

- **`/permissions`.** A dialog that "lists all permission rules and the `settings.json` file each rule comes from", grouped by scope. You can add and remove rules, manage working directories, and edit auto mode rules on a tab added in 2.1.246. It is the only native view with provenance for each item. It doesn't say what the rules allow together, and an agent can't call it. Sources: [permissions](https://code.claude.com/docs/en/permissions), [commands](https://code.claude.com/docs/en/commands).
- **`/mcp`, `claude mcp list` and `get`.** Lists every configured server with its connection status and project approval.
  - In the hands-on run, `claude mcp list` showed claude.ai connectors, a plugin server and the temporary project's server together.
  - `claude mcp get` printed "Scope: Project config (shared via .mcp.json)".
  - `claude mcp add` and `remove` with `-s <scope>` are typed edits an agent can run through Bash.

  Sources: [debug-your-config](https://code.claude.com/docs/en/debug-your-config), [mcp](https://code.claude.com/docs/en/mcp), hands-on.
- **`/agents`.** Since 2.1.198 it prints a reminder to ask Claude or to edit `.claude/agents/`, and the interactive wizard is gone. Subagents and their sources now show in `/context`. When two files in one directory share a `name`, one of them loads, "chosen by filesystem read order rather than a documented precedence", and `/doctor` flags it. Sources: [commands](https://code.claude.com/docs/en/commands), [sub-agents](https://code.claude.com/docs/en/sub-agents).
- **`/memory`.** Lists CLAUDE.md, CLAUDE.local.md and memory file locations across user and project scopes, including files that don't exist yet. It also toggles auto memory. What actually loaded is in `/context`. Source: [memory](https://code.claude.com/docs/en/memory).
- **`/hooks`.** Lists every hook registered for the session, grouped by event. Since 2.1.281, a hook's detail screen says what kind of hook it is and where to change it. Sources: [debug-your-config](https://code.claude.com/docs/en/debug-your-config), [changelog](https://code.claude.com/docs/en/changelog).
- **`/status`.** Lists the settings files loaded and the managed source with how it arrived. Since 2.1.243 it also lists managed sources that were skipped. The docs say plainly that it "doesn't show which file supplied each key". Source: [settings](https://code.claude.com/docs/en/settings).
- **`/doctor`, `claude doctor` and `/doctor prompt-audit`.**
  - `/doctor` has been an LLM skill since 2.1.205. It checks for unparseable settings, extensions that are unused relative to their context cost, slow hooks, MCP servers defined in several scopes with different endpoints, and duplicate subagent names. It proposes fixes and asks before applying them.
  - `claude doctor` prints read-only diagnostics, including the entries Claude Code rejected.
  - `prompt-audit` (2.1.283) audits CLAUDE.md, skills, agents and commands for prompting patterns written for older models.

  Sources: [commands](https://code.claude.com/docs/en/commands), [changelog](https://code.claude.com/docs/en/changelog).
- **`/context`.** Shows what fills the context window, by category. That includes custom subagents with the source each loaded from, memory files, skills and, since 2.1.283, MCP server instructions. It is the closest native answer to "what loaded", but it covers instructions and tools, not permissions or hooks. Source: [debug-your-config](https://code.claude.com/docs/en/debug-your-config).
- **`claude auto-mode config` and `critique`.** `config` prints the effective auto mode classifier rules as JSON: "your settings where set, defaults otherwise". `critique` asks a model for feedback on your custom rules. The slice is narrow, but it is the only native effective-config output in JSON. Source: hands-on.
- **`claude plugin validate` and `plugin details`.**
  - `validate` checks plugin and marketplace manifests. Since 2.1.233 it also checks the `skills`, `agents` and `commands` under a `.claude` directory. `--strict` and `--json` suit CI.
  - It checks structure only. It never reads `settings.json`. The hands-on probe passed an invalid `permissionMode`, an unknown tool, a literal bearer token and a `curl … | sh` hook without a finding.
  - `details` lists one installed plugin's skills, agents, hooks and MCP servers, with its projected token cost.

  Sources: [plugins CLI reference](https://code.claude.com/docs/en/plugins/cli-reference), hands-on.
- **Managed and server-managed settings.** Admins deploy policy by file, by MDM, or as JSON in the claude.ai console.
  - On developer machines, risky delivered settings need the user's approval in a dialog that explains them. These are shell-command settings, settings that weaken the sandbox, proxy and base-URL variables, and any hook.
  - The console has no preview or diff. The docs say to validate a payload with `claude doctor` on a test machine.
  - Audit events with references to old and new values come through the compliance API.

  Sources: [server-managed-settings](https://code.claude.com/docs/en/server-managed-settings), [managed-settings](https://code.claude.com/docs/en/managed-settings).
- **Protected paths, workspace trust and `ConfigChange`.**
  - Agent writes to `.claude/` (agent files included) and `.mcp.json` are never auto-approved. They prompt in default and acceptEdits modes, go to the classifier in auto mode, and are denied in dontAsk. `allow` rules can't pre-approve them.
  - The trust dialog shown when a folder is first opened lists the allow rules and directories the repository would grant.
  - `ConfigChange` (2.1.49) fires when settings files or skills change, and it can block the change. It receives only the source and the file path, and a blocked change shows no message. Agent files, `.mcp.json`, CLAUDE.md and AGENTS.md don't trigger it.

  Sources: [permission-modes](https://code.claude.com/docs/en/permission-modes), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks).
- **Code Review.** Anthropic's managed PR reviewer is in research preview for Team and Enterprise. It posts severity-tagged inline comments and a check run that never blocks a merge. `REVIEW.md` can add checks specific to the repository, so a team can ask it to flag permission widening. It is an LLM review: not reproducible, and about $15 to $25 per review. Source: [code-review](https://code.claude.com/docs/en/code-review).

### Other vendors

- **`ant apply`.** Config as code for Claude Managed Agents: agents, environments, skills, memory stores and deployments, each declared as a file.
  - It prints a plan and, on request, a field-by-field diff of each update. It applies after approval, and it refuses when a resource changed outside the files.
  - It doesn't touch Claude Code project configuration.
  - For pull requests, the docs suggest `ant apply --dry-run .` in CI. The plan lands in the job log, not in a comment.

  Sources: [ant apply](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/apply), [anthropic-cli](https://github.com/anthropics/anthropic-cli).
- **GitHub Copilot managed-settings validator and enterprise-managed permissions.**
  - The validator (2026-09-25) checks `copilot/managed-settings.json`, `copilot/team-mappings.json` and the team files they reference. It reports malformed JSON, unsupported settings and invalid team mappings, each with its file and JSON path, on the enterprise AI controls page. It runs after a commit to the default branch of `.github-private`, not on pull requests.
  - Enterprise-managed permissions (generally available since 2026-09-09) centrally block, gate or allow shell commands, file access and network domains. There is no view of the effective result.

  Sources: [validator changelog](https://github.blog/changelog/2026-09-25-enterprise-managed-settings-in-product-validator/), [GitHub docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/get-started), [permissions changelog](https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations/).

### Third-party tools named in the protocol

- **rulesync** (1,477 stars; about 886,000 npm downloads last month). Generates configuration for about 50 tools from one `.rulesync/` source.
  - For Claude Code that includes rules, commands, subagents, skills, hooks and permissions.
  - `--dry-run` lists the files it would write, and `--check` fails CI when generated files are stale. Its MCP server lets agents list, get, put and delete per feature.
  - It merges into shared files such as `.claude/settings.json` without dropping unrelated keys, and it edits some JSONC files span by span.
  - It has no effective view, no diff and no risk labels.

  Sources: [README](https://github.com/dyoshikawa/rulesync), [docs](https://github.com/dyoshikawa/rulesync/tree/main/docs).
- **ruler** (2,936 stars; about 246,000 npm downloads last month). Distributes one set of instructions to many agents. For Claude Code that means CLAUDE.md, `.mcp.json` (merged by default), skills and subagents. `apply --dry-run` previews the change and `revert` restores from backups. It doesn't touch permissions or hooks. Source: [README](https://github.com/intellectronica/ruler).
- **Looper** (710 stars). A Claude Code skill that coaches you through designing an agent loop, then writes `loop.yaml`, a compiled spec and a readable `LOOP.md`. `looper lint` checks specs in CI. Its specs have explicit gates, and its README says its token and cost caps are "advisory limits unless you add accounting". It doesn't inspect Claude Code configuration. Source: [README](https://github.com/ksimback/looper).
- **harness-audit** (5 stars; `fmslutions/harness-audit` redirects to `fabianmartinelli-fm/harness-audit`). An Agent Skill.
  - It inventories what each agent loads before the first prompt and measures the tokens.
  - It proposes a plan grouped by risk and applies the approved items on a branch. It installs lint hooks, a pre-commit check and CI.
  - Its inventory reads managed, user, project and local settings to find which instruction files load. It does not evaluate permissions.
  - [Issue #3](https://github.com/fabianmartinelli-fm/harness-audit/issues/3) plans to report "which file actually wins" between AGENTS.md and CLAUDE.md.

  Source: [README](https://github.com/fabianmartinelli-fm/harness-audit).
- **claude-memory-map** (0 stars). An interactive diagram of Anthropic's memory stores across chat, Claude Code and Cowork. It is documentation: "No user-specific configuration is represented." [Issue #47](https://github.com/Adam-S-Daniel/claude-memory-map/issues/47) tracks updating the map for the AGENTS.md support added in Claude Code 2.1.277. Source: [README](https://github.com/Adam-S-Daniel/claude-memory-map).

### Found by search

- **agentshield** (1,229 stars; about 37,000 npm downloads last month; created 2026-02-11). A security scanner for Claude Code configuration.
  - It has 268 rules over secrets, permissions, hooks, MCP servers and agent files, with a 0-100 score and an A-F grade.
  - The GitHub Action writes a job summary, inline annotations and SARIF. With a committed baseline, it reports new and resolved findings and the score change.
  - `--fix` rewrites literal secrets as `${VAR}` and narrows wildcard permissions, then re-scans and rolls back if the score drops.
  - It also ships as a plugin and as a GitHub App, which has a paid tier at $19 per seat per month.

  Source: [README](https://github.com/affaan-m/agentshield).
- **agent-assurance** (3 stars; created 2026-09-16; Apache-2.0 per its README). Compares what a repository's MCP config and Claude permission rules grant with a declared manifest, `agent-assurance.yaml`.
  - In `diff` mode it keeps one PR comment current on every push, shows the change in blast radius, and fails the check when the declared promise breaks.
  - An MCP tool (`would_break`) and a PostToolUse hook tell the agent while it edits.
  - It is deterministic, makes no network calls, maps to OWASP, and can write a signed attestation for each commit.
  - It doesn't read subagent frontmatter, hooks or skills.

  Sources: [README](https://github.com/kunko-ai-labs/agent-assurance), [how it works](https://github.com/kunko-ai-labs/agent-assurance/blob/main/docs/how-it-works.md), [integrations](https://github.com/kunko-ai-labs/agent-assurance/blob/main/docs/integrations.md).
- **agent-pr-reviewer-lite** (1 star; created 2026-06-04). A deterministic PR pre-screen that posts a PR comment, annotations and SARIF.
  - Claude Code rules were added on 2026-09-24. Changes to `.claude/settings.json`, `.claude/hooks/**` or `.mcp.json` are high risk, and the reason names the risky keys the change adds.
  - Agent, skill and command files count as instruction changes, at medium.
  - Its README says it "does not understand code semantics".

  Sources: [README](https://github.com/alipajand/agent-pr-reviewer-lite), [PR #37](https://github.com/alipajand/agent-pr-reviewer-lite/pull/37).
- **agent-permission-diff** (0 stars; created 2026-08-19; on npm). Snapshots Claude Code, Codex and Cursor permissions into a committed lockfile. It then reports newly broadened capabilities by category: read, write, shell, approval, sandbox, network, bypass and MCP. Output is Markdown or SARIF, with an `explain` command. It says it doesn't reproduce "hidden runtime precedence". Its npm downloads were about 27,000 last month: 6,717 on one day, then about 1,000 a day. That pattern suggests automated installs rather than adoption. Source: [README](https://github.com/DebadityaHait/agent-permission-diff).
- **MONNA agent-permission-diff** (0 stars; created 2026-09-07). Compares two versions of Claude settings (`allow`, `deny`, `ask`, `additionalDirectories`, `defaultMode`) or of MCP JSON, including removed deny and ask rules. It never prints configuration values, and its PR mode writes to the job summary. In its own executed comparison (first-party, 2026-09-07), agent-permission-diff produced a finding in 4 of 11 changed fixtures, against 11 of 11 for MONNA. Sources: [README](https://github.com/emanalshazly/monna-agent-permission-diff), [comparison](https://github.com/emanalshazly/monna-agent-permission-diff/blob/main/docs/THREE-ALTERNATIVE-REVIEW.md).
- **agent-permission-diff-bot** (0 stars) and **agentcapdiff** (1 star). The bot diffs MCP configs, GitHub Actions token permissions, egress policy and instruction files between two git refs. agentcapdiff inventories serialized tool definitions (MCP, OpenAI, Claude, LangChain, CrewAI) and diffs capability snapshots on pull requests. Neither reads Claude Code settings or subagents. Sources: [bot README](https://github.com/saagpatel/agent-permission-diff-bot), [agentcapdiff README](https://github.com/nqtplus/agentcapdiff).
- **ruleblast** (19 stars; created 2026-08-12). For each tracked file, it works out which instruction stack Codex, Claude Code, Gemini CLI and Copilot CLI would load, and diffs that between git refs. `explain` names the source chain. It covers instructions only. Source: [README](https://github.com/Kpoiut/ruleblast).
- **settings-effective, skill-rollcall and mcp-rollcall** (1 star each; created 2026-09-19).
  - settings-effective prints every effective Claude Code settings key with the file that set it, plus the trust state and why a setting isn't applying: wrong scope, shadowed, outranked by `ask` or `deny`, or a typo.
  - The two siblings do the same for skills and MCP servers.
  - All three are read-only stdlib Python and run as a skill or a CLI.
  - They read files, not the running harness, so policy delivered by MDM or the console is invisible to them.

  Sources: [settings-effective](https://github.com/Londopy/settings-effective), [mcp-rollcall](https://github.com/Londopy/mcp-rollcall), [skill-rollcall](https://github.com/Londopy/skill-rollcall).
- **Snyk agent-scan** (3,090 stars; formerly Invariant `mcp-scan`). Finds MCP servers and skills across agents, Claude Code included. It scores risks such as tool poisoning, prompt injection and malicious skills. It has no base-versus-PR diff. Source: [README](https://github.com/snyk/agent-scan).
- **claudelint** (12 stars; npm `claude-code-lint`). 116 rules over CLAUDE.md, skills, settings (schema, permission rules, tool names), hooks, MCP servers and plugins. It has `--fix`, CI support and SARIF output. Sources: [repository](https://github.com/pdugan20/claudelint), [site](https://claudelint.com/).
- **speckit-gate** (0 stars) and **specforge** (1 star). Both install hooks that enforce spec-driven gates. speckit-gate publishes a matrix, per agent and per invocation channel, of which gates it can enforce, which it can only advise on, and which it can't reach. specforge says the "human approve" step is advisory unless its hook enforces it. Neither analyzes an existing project's gates. Sources: [speckit-gate](https://pypi.org/project/speckit-gate/), [specforge](https://github.com/pooyagolchian/specforge).

### Also found, not rated

- **claude-code-tool-manager** (380 stars) is a desktop GUI with its own MCP server for managing MCP servers, commands, skills, subagents and hooks. Its README places project MCP config at `.claude/.mcp.json`. Claude Code reads project servers from `.mcp.json` at the repository root ([debug-your-config](https://code.claude.com/docs/en/debug-your-config)).
- **claude-config-viewer** (0 stars) is a read-only local web UI over `~/.claude`.
- **agentdrift** (2 stars) tracks changes to instruction files through git history, with 20 rules.
- **mcp-diff** (0 stars) diffs MCP server manifests after introspecting the servers.
- **MCP vulnerability scanners with CI or SARIF output**: Cisco mcp-scanner (1,080 stars), guardmcp, mcp-check and AgentAuditKit.
- **agentlint** (32 stars) provides hooks-based guardrails.
- **cclint**, two projects (17 and 22 stars), are Claude Code linters.
- **Microsoft Agent Hooks 0.1** (published 2026-08-27) is a framework-neutral governance contract for agent frameworks, including the Claude Agent SDK. It covers interception points, allow, deny and transform verdicts, approval bindings, and audit records.[^45]

## Gaps that remain

| Gap | Verdict | Best existing coverage | What nobody covers |
|---|---|---|---|
| Effective config | Partly covered | Native runtime views for each surface; `/permissions` names each rule's file; settings-effective gives per-key provenance for settings | One pre-merge view of a whole project at a git ref, per subagent, in plain language |
| Risk-labeled semantic diff where review happens | **Covered for permission rules and MCP servers.** Partly covered for the rest | agent-assurance (PR comment, hook, MCP tool); agentshield (findings drift, annotations); agent-pr-reviewer-lite (PR comment) | Semantic changes to subagent frontmatter, hooks, skill `allowed-tools`, enabled plugins and gates, with scope rules that match the Claude Code version |
| Deterministic editing | Partly covered | rulesync and ruler (generation); `claude mcp add` and `remove`, `/permissions`, plugin enable and disable; agentshield `--fix`; `ant apply` for Managed Agents | Typed operations on native Claude Code files, with a dry-run plan and a hash check, that an agent can call |
| Gate enforcement map | **Uncovered** | Tools that describe their own gates (speckit-gate, specforge, Looper); agent-assurance's human-approval check | Mapping an existing project's declared gates to hooks, permission rules or CI, and flagging the advisory ones |

### 1. Effective config: partly covered

Claude Code answers "what loaded" for each surface, inside a session:

- `/context`: instructions, skills, subagents and MCP tools;
- `/permissions`: rules and the files they come from;
- `/hooks`, `/mcp`, `/memory` and `/status`: the rest.

Anthropic's own [debug guide](https://code.claude.com/docs/en/debug-your-config) is built on these views.

The documented hole is provenance for each key. `/status` "doesn't show which file supplied each key", and denials don't say which rule fired. Both are open issues, [#87153](https://github.com/anthropics/claude-code/issues/87153) and [#95970](https://github.com/anthropics/claude-code/issues/95970). settings-effective reconstructs the settings part from files. harness-audit and ruleblast cover instruction files.

What is left is a view that:

- works before merge, with no session and no trust dialog;
- covers every surface at once;
- computes each subagent's effective tools: `tools` minus `disallowedTools`, plus `permissionMode`, inline MCP servers and skills;
- explains the result in plain language.

Two cautions:

- **Native views always match the running version. File-based tools must track semantics that change weekly.** Claude Code shipped 26 releases between 2026-08-28 and 2026-09-25, with about 86 "Changed" or "Added" changelog entries touching settings, permissions, hooks, agents, skills or MCP.[^41]
- **Several project-scope keys are now ignored by design.** For example, `defaultMode: "bypassPermissions"` in `.claude/settings.json` has been ignored since 2.1.257.

### 2. Risk-labeled semantic diff where review happens: covered for the core

**This is the main H3 finding.** For permission rules and MCP servers the diff exists, and one tool does it well:

- **agent-assurance.** In `diff` mode it keeps one PR comment current, shows the change in blast radius, and fails a check. Its Claude Code hook and MCP tool warn the agent before or right after the edit.
- **agent-pr-reviewer-lite.** Posts a PR comment that names risky keys added to settings, hooks and MCP files.
- **agent-permission-diff and MONNA.** Diff permission keys, including removals, into Markdown or SARIF.
- **agentshield.** Its drift gate reports new and resolved findings as inline annotations.
- **Claude Code Review.** It can be told in `REVIEW.md` to flag config changes, as an LLM review.

Six diff tools appeared between June and September 2026, and none has more than 3 stars.[^42] agent-assurance's own landscape review reached the same reading on 2026-09-17: "the idea is obvious enough that several people built it independently, and nobody has found distribution or a reason for others to adopt it."[^43] The constraint looks like adoption, not implementation.

What is left is completeness and correctness:

- **Subagents, hooks, skills and plugins.** No diff tool reports changes to subagent frontmatter (`tools`, `disallowedTools`, `permissionMode`, `mcpServers`, `skills`), hooks added or removed, skill `allowed-tools`, enabled plugins, or gates as before-and-after changes. Two tools come close without reporting the change itself:
  - agentshield's drift gate would show a new finding when an agent gains unrestricted Bash;
  - agent-pr-reviewer-lite flags `permissionMode: bypassPermissions` in added lines and otherwise treats agent files as a medium "instructions changed" finding.
- **Detection quality varies.** In MONNA's first-party test, agent-permission-diff produced a finding in 4 of 11 changed fixtures.[^34]
- **The native prompt shows the raw edit, not its meaning.** In-host, Claude Code already stops agent writes to `.claude/` and `.mcp.json` at a permission prompt in default and acceptEdits modes.[^17]

### 3. Deterministic editing: partly covered

It is covered in four places:

- where one source generates the files (rulesync and ruler; rulesync also has an MCP tool);
- for MCP servers and plugins, through native commands (`claude mcp add` and `remove` with `-s`, `claude plugin enable` and `disable`);
- for permission rules, interactively (`/permissions`);
- for two narrow fixes, through agentshield `--fix`.

`ant apply` is the model the strategy cites: plan, approve, apply, and refusal on drift. But it manages Managed Agents API resources, not local files.

What is left: typed operations on native Claude Code files, especially agent frontmatter, hooks and permission rules. They would have a dry-run plan, a hash check and byte-stable output, and an agent could call them. We found no evidence that agents prefer such a tool to editing files directly. The strategy already names that as its riskiest assumption.

### 4. Gate enforcement map: uncovered

No tool reads a project's declared gates and reports which ones hooks, permission rules or CI enforce and which ones are only advice. A declared gate here means a Spec Kit, Kiro or AI-DLC gate, or a "a human approves this" line in CLAUDE.md.

Adjacent work:

- speckit-gate and specforge document enforcement tiers for their own gates.
- Looper marks its own caps as advisory.
- agent-assurance fails a declared "human approves" promise when `allow` rules auto-approve.

Claude Code's docs draw the same line ("Use CLAUDE.md for 'we do it this way here.' Use permissions or hooks for security boundaries"), but no tool applies it to a project.

## Threats to watch (to March 2027)

We found no announced or preview feature from Anthropic or GitHub that promises a semantic config diff or a per-key effective-config view. These could close a gap quickly:

| Signal | Status on 2026-09-27 | Gap it would close |
|---|---|---|
| Per-key provenance in `/status` or `claude doctor` | Not announced. The docs name the gap, and issues #87153 and #95970 are open. Claude Code shipped 26 releases in four weeks. | Effective config |
| `claude plugin validate` extended to project settings | Steps already shipped: `.claude/` directories (2.1.233), `--json` (2.1.259), `.mcp.json` checks (2.1.281) | `validate` |
| `ConfigChange` passing old and new content | The hook shipped in February 2026 with source and path only | Diff in the host |
| Claude Code Review becoming generally available, or gaining a built-in agent-config category | Research preview, `REVIEW.md` rules, about $15-25 per review | Diff in the PR, as an LLM review |
| History and fleet views for server-managed settings | Audit events with old and new values through the compliance API; OTel `managed_settings_resolved` (2.1.274) | Effective config and diff, managed scope |
| GitHub validator running on pull requests; GitHub Universe (Oct 28-29) | Validator shipped 2026-09-25; runs after commit, on an admin page | PR review of managed settings |
| GitHub assisted approvals | Public preview: auto-approves low-risk tool calls, prompts for higher-risk ones[^46] | Runtime risk, not config review |
| Agent Plugins 1.0 | Generally available since 2026-08-12, from AWS, Anysphere, Microsoft, OpenAI, Vercel and Google, not Anthropic. Plugins carry agents, rules, hooks and MCP config[^44] | Enlarges the surface to review |
| agentshield adding capability diffs | Baseline drift shipped; active; paid GitHub App | Diff in the PR |
| agent-assurance widening its coverage | Reached v0.6.0 in 11 days; next is a `--baseline` option | Diff in the PR, part of the gate map |
| Microsoft Agent Hooks 0.1 | Published 2026-08-27 for agent frameworks[^45] | Standard gate semantics |

The next event windows: OpenAI DevDay (Sep 29), AGNTCon and MCPCon (Oct 22-23), GitHub Universe (Oct 28-29), Microsoft Ignite (Nov 17-20) and AWS re:Invent (Nov 30 to Dec 4).

## What this means for v0.1 scope

1. **A risk-labeled diff in a PR comment is table stakes, not the wedge.** Six implementations have no traction. `decision.md` should weigh that alongside H1, as weak evidence about demand.
2. **If v0.1 goes ahead, compete on coverage and correctness.**
   - Model the whole Claude Code surface, especially subagent frontmatter, hooks, skill `allowed-tools`, plugins, and removals.
   - Apply scope rules that match the Claude Code version.
   - Publish a fixture suite with detection rates. The H2 tasks and `score.mjs` already encode most change types.
3. **Lead with the gate enforcement map.** It is the only gap nobody covers. The existing fidelity levels (native, approximated, advisory, unsupported) already express it.
4. **Narrow `validate`.** `claude plugin validate` already checks frontmatter parse errors under `.claude/` with `--json` and `--strict`, and `claude doctor` already lists rejected settings entries. Don't re-implement those. Keep cross-file references (a `skills` or `mcpServers` entry that names nothing), invalid enum values, and settings semantics.
5. **Make `inspect` pre-merge and per agent.** Runtime views for each surface are native, and per-key settings provenance already exists.
6. **Move the hook before the write.** Agent writes to `.claude/` and `.mcp.json` already stop at a native prompt in default and acceptEdits modes.
   - A `PreToolUse` or `PermissionRequest` hook could put the risk summary in front of the person at that prompt through `systemMessage`. `PostToolUse` only reports after the write.
   - `ConfigChange` covers settings and skills edited outside Claude's tools.
   - None of this was tested.
7. **Consider contributing instead of adding a seventh tool.** agent-assurance (Apache-2.0) already has the PR comment, the hook and the MCP tool. settings-effective (MIT) already has per-key provenance.

## Hands-on log

Claude Code 2.1.143 on macOS, 2026-09-27. Probes lived in a scratch directory. No real configuration was changed.

| Command | Result |
|---|---|
| `claude --version` | `2.1.143 (Claude Code)`. The current release is 2.1.283 (2026-09-25). |
| `claude plugin validate ./plugin-out` (the Context Canvas plugin export) | Validated only `.claude-plugin/marketplace.json`: "Validation passed". The docs say a marketplace run doesn't open plugin files. |
| The same export validated as a plugin (a copy without `marketplace.json`) | "Validation passed with warnings": no `author`. |
| Probe plugin with defects | Errors: agent YAML that doesn't parse ("loads with empty metadata"), the unknown hook event `PreToolUsee`, and `Stop` given as an object. Warnings: a missing agent `description` and a missing `author`. Not flagged: `permissionMode: yolo`, the unknown tool `NotATool`, `model: gpt-5`, the unknown key `colour` (which Claude Code ignores), a stdio MCP server with no `command` (2.1.281 may now catch this), a literal bearer token in MCP headers, a `curl … \| sh` hook, and `allowed-tools: Bash(*)`. A skill whose `name` differs from its directory is valid according to the docs. |
| Probe skill and command files | YAML parse errors reported for both. A skill with no `name` and an unknown key got no finding; `name` is optional for skills. |
| A plain project directory (`.claude/settings.json` and one agent) | "No manifest found". Versions 2.1.233 and later validate `.claude/` components. Passing `settings.json` itself makes it parse as a plugin manifest: "Unrecognized key: permissions". |
| `claude mcp list` in a temporary project with one HTTP server | Listed claude.ai connectors, a plugin server and the project server, each with health ("Failed to connect"). Since 2.1.196, untrusted folders show "Pending approval" for servers the repository approved in its own settings. |
| `claude mcp get probe-http` | "Scope: Project config (shared via .mcp.json)". Headers were printed with `${PROBE_TOKEN}` unexpanded. |
| `claude plugin details vercel@claude-plugins-official` | 37 skills, 0 agents, 3 hooks and 1 MCP server; about 4,222 always-on tokens. |
| `claude auto-mode config` | Effective auto mode rules as JSON, with keys `allow` (9), `soft_deny` (30), `hard_deny` (2) and `environment` (5). |

[^1]: `/permissions` "lists all permission rules and the `settings.json` file each rule comes from". The dialog lets you "view rules by scope, add or remove rules, manage working directories". <https://code.claude.com/docs/en/permissions> and <https://code.claude.com/docs/en/commands>, accessed 2026-09-27.
[^2]: `/mcp` shows "every configured server, its connection status, and whether you have approved it for the current project" (<https://code.claude.com/docs/en/debug-your-config>, accessed 2026-09-27). Hands-on (2.1.143, 2026-09-27): `claude mcp get` printed "Scope: Project config (shared via .mcp.json)", and `claude mcp add` and `remove` take `-s <scope>` (`claude mcp --help`). Since 2.1.205, `/mcp` in `-p` mode prints a text summary (<https://code.claude.com/docs/en/commands>, accessed 2026-09-27).
[^3]: "As of v2.1.198, running `/agents` prints a reminder to ask Claude to create or manage subagents, or to edit `.claude/agents/` or `~/.claude/agents/` directly." <https://code.claude.com/docs/en/commands>, accessed 2026-09-27.
[^4]: "The `/memory` command lists your CLAUDE.md, CLAUDE.local.md, and other memory file locations across user and project scopes." <https://code.claude.com/docs/en/memory>, accessed 2026-09-27.
[^5]: "Run `/hooks` to list every hook registered for the current session, grouped by event" (<https://code.claude.com/docs/en/debug-your-config>). In 2.1.281, "a hook's detail screen now says what kind of hook it is and where to change it", and the notices "each say what is happening in one plain sentence" (<https://code.claude.com/docs/en/changelog>). Accessed 2026-09-27.
[^6]: "The line confirms which files Claude Code read; it doesn't show which file supplied each key." (<https://code.claude.com/docs/en/settings>). The `Skipped sources` line was added in 2.1.243 (<https://code.claude.com/docs/en/changelog>). Accessed 2026-09-27.
[^7]: `/doctor` checks "unparseable settings files", finds unused extensions "versus their context cost", "flags slow hooks", and "Reports findings first and asks for confirmation before changing anything". `claude doctor` "prints read-only installation diagnostics" (<https://code.claude.com/docs/en/commands>). It also reports "duplicate subagent names in the same directory" (<https://code.claude.com/docs/en/debug-your-config>). It became a full checkup in 2.1.205; the MCP multi-scope warning arrived in 2.1.110; `prompt-audit` in 2.1.283 audits "CLAUDE.md files, skills, agents and commands for prompting patterns written for older models" (<https://code.claude.com/docs/en/changelog>). Accessed 2026-09-27.
[^8]: `/context` shows "system prompt, system tools, MCP tools, custom subagents with the source each loaded from, memory files, skills, and conversation messages" (<https://code.claude.com/docs/en/debug-your-config>). MCP server instructions got their own row in 2.1.283 (<https://code.claude.com/docs/en/changelog>). Accessed 2026-09-27.
[^9]: Hands-on (2.1.143, 2026-09-27). `claude auto-mode config`: "Print the effective auto mode config as JSON: your settings where set, defaults otherwise". `critique`: "Get AI feedback on your custom auto mode rules".
[^10]: `plugin validate` can "Validate a plugin manifest, a marketplace manifest, or the skills, agents, and commands in a directory". Validating component files without a manifest requires 2.1.233; `--strict` requires 2.1.145; `--json` requires 2.1.259. `plugin details` shows "a plugin's component inventory and its projected token cost". <https://code.claude.com/docs/en/plugins/cli-reference>, accessed 2026-09-27.
[^11]: Hands-on probes on 2.1.143; see the log. Since then, 2.1.281 added checks for "`.mcp.json` entries that would be silently dropped at load, undeclared `${user_config.*}` references, and insecure URLs", plus a warning for unquoted `${CLAUDE_PLUGIN_ROOT}` (<https://code.claude.com/docs/en/changelog>, accessed 2026-09-27). These were not tested here.
[^12]: "run `/status`: the `Setting sources` line names the managed source that applies to you" (<https://code.claude.com/docs/en/settings>). 2.1.274: "Added `claude_code.managed_settings_resolved` OTel event: managed-settings sources and policy helper state" (<https://code.claude.com/docs/en/changelog>). Accessed 2026-09-27.
[^13]: "Certain settings that could pose security risks require explicit user approval": shell-command settings, sandbox binary and network settings, some `env` variables, and "any hook definition". "Users see a security dialog explaining what is being configured." <https://code.claude.com/docs/en/server-managed-settings>, accessed 2026-09-27.
[^14]: Admins "Add your configuration as JSON" in the console, and should "Validate a payload change with `claude doctor` on a test machine before rolling it out to the organization". Audit events include "references to the previous and new values", through the compliance API. <https://code.claude.com/docs/en/server-managed-settings>, accessed 2026-09-27.
[^15]: Project `allow` rules and `additionalDirectories` apply "only after you accept the workspace trust dialog". "The dialog lists the rules and directories the folder would grant so you can review them first." <https://code.claude.com/docs/en/permissions>, accessed 2026-09-27.
[^16]: `ConfigChange` matches `user_settings`, `project_settings`, `local_settings`, `policy_settings` and `skills`. Its input adds `source` and an optional `file_path`. "A blocked change surfaces no message to you or to Claude." <https://code.claude.com/docs/en/hooks>, accessed 2026-09-27.
[^17]: Protected directories include `.claude` (except `.claude/worktrees`). Protected files include `.mcp.json` and `.claude.json`. Writes to them are prompted in `default` and `acceptEdits`, routed to the classifier in `auto`, denied in `dontAsk`, and allowed in `bypassPermissions`. "`permissions.allow` rules in settings files do not pre-approve protected-path writes." <https://code.claude.com/docs/en/permission-modes>, accessed 2026-09-27.
[^18]: "Code Review is in research preview, available for Team and Enterprise subscriptions." "Findings are tagged by severity and don't approve or block your PR." `REVIEW.md` supports "Repo-specific checks". "Each review averages $15-25 in cost." <https://code.claude.com/docs/en/code-review>, accessed 2026-09-27.
[^19]: `ant apply` manages "agents, environments, skills, memory stores, and deployments". Answering `d` shows "a field-by-field diff of each update". Lockfile hashes let "a later run" notice "an edited file, or a resource changed outside these files". Flags include `--dry-run`, `--yes`, `--force` and `--prune`. <https://platform.claude.com/docs/en/cli-sdks-libraries/cli/apply>, accessed 2026-09-27.
[^20]: "On pull requests, run `ant apply --dry-run .` to print the plan for reviewers. It's informational only and exits 0 even when the plan is blocked." (same page). The CI example at <https://github.com/anthropics/anthropic-cli> applies on `main` after merge. Accessed 2026-09-27.
[^21]: The validator checks `copilot/managed-settings.json`, `copilot/team-mappings.json` and referenced team files. "Each issue identifies the affected file and JSON path." Fixes are committed "to the default branch of the `.github-private` repository", and the admin reloads the Agents page. Client settings are confirmed by observing behavior. <https://github.blog/changelog/2026-09-25-enterprise-managed-settings-in-product-validator/> and <https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/get-started>, accessed 2026-09-27.
[^22]: For Claude Code, rulesync supports rules, ignore, MCP, commands, subagents, skills, hooks and permissions (README, <https://github.com/dyoshikawa/rulesync>). `--dry-run` and `--check` are in `docs/guide/dry-run.md`. The single `rulesyncTool` with list, get, put and delete is in `docs/reference/mcp-server.md`. Shared-file merges and span-level JSONC edits are in `docs/reference/cli-commands.md`. Accessed 2026-09-27.
[^23]: For Claude Code, ruler writes `CLAUDE.md`, `.mcp.json`, `.claude/skills/` and `.claude/agents/`. It has `--dry-run`, `--mcp-overwrite` (merge is the default), `revert`, and `.bak` backups. <https://github.com/intellectronica/ruler>, accessed 2026-09-27.
[^24]: Looper writes "`loop.yaml`, a compiled `loop.resolved.json`, a human-readable `LOOP.md`". It has `looper lint` with `--json` and `--strict`. "token/USD caps are operator-visible advisory limits unless you add accounting around the configured CLIs." <https://github.com/ksimback/looper>, accessed 2026-09-27.
[^25]: The README describes an "Inventory of loaded context" for each agent, approval grouped by risk (Low, Medium, High), lint codes H001 to H022, and an `apply` that "Creates a git branch … executes only the plan items you approved". `skills/harness-audit/scripts/inventory.py` reads the managed, user, project and local settings layers and lists plugins, MCP servers and SessionStart hooks. <https://github.com/fabianmartinelli-fm/harness-audit>, accessed 2026-09-27.
[^26]: "No user-specific configuration is represented." <https://github.com/Adam-S-Daniel/claude-memory-map>, accessed 2026-09-27.
[^27]: "268 rules across 15 modules, graded A to F with a 0 to 100 numeric score." It "auto-discovers your `~/.claude/` directory". Findings carry a `runtimeConfidence` such as `active-runtime`, `project-local-optional` or `plugin-cache`. It produces an HTML report and has an optional `--opus` analysis. <https://github.com/affaan-m/agentshield>, accessed 2026-09-27.
[^28]: The Action takes a `baseline` input and outputs `new-findings`, `resolved-findings`, `unchanged-findings` and `score-delta`. It "writes a markdown job summary and emits GitHub annotations inline on affected files". <https://github.com/affaan-m/agentshield>, accessed 2026-09-27.
[^29]: `--fix` "Replaces hardcoded secrets with `${ENV_VAR}` references" and "Tightens wildcard permissions", and "Permission changes require human review". After applying fixes "it re-scans the target, and if the posture score regressed … it rolls every modified file back". <https://github.com/affaan-m/agentshield>, accessed 2026-09-27.
[^30]: The observed sources are MCP configs (`.mcp.json` and the Cursor, Gemini, VS Code and Codex equivalents), "Claude Code permissions — `.claude/settings.json` and `settings.local.json`", and serialized tool definitions. `AGENTS.md` is "detected but not supported". AA-002 fails on "an unscoped auto-approval under a human-approves promise". The tool also produces an HTML capability card and an OWASP mapping. <https://github.com/kunko-ai-labs/agent-assurance> and `docs/how-it-works.md`, accessed 2026-09-27.
[^31]: "in `diff` mode one PR comment is created and then updated on every push". The CLI runs `diff base-checkout head-checkout --fail-on-delta`. There are MCP tools `scan`, `check` and `would_break`, and a PostToolUse hook. <https://github.com/kunko-ai-labs/agent-assurance/blob/main/docs/integrations.md>, accessed 2026-09-27.
[^32]: The rules are `agent-permissions-changed` (High; covers `.claude/settings.json`, `.claude/hooks/**`, `.mcp.json` and others; "names risky keys the change adds"), `agent-local-settings-committed` (High), `agent-auto-run-added` (High), and `agent-instructions-changed` (Medium; includes Claude agents, skills and commands). "It does not understand code semantics." Options include `--github-comment` and `--explain`. <https://github.com/alipajand/agent-pr-reviewer-lite>; Claude rules merged in PR #37 on 2026-09-24. Accessed 2026-09-27.
[^33]: Snapshot categories are `read`, `write`, `shell`, `approval`, `sandbox`, `network`, `bypass` and `mcp`, with confidence `declared`, `effective_best_effort` or `unknown`. It "does not … claim to reproduce every provider's hidden runtime precedence". It has `explain <number>`. <https://github.com/DebadityaHait/agent-permission-diff>, accessed 2026-09-27.
[^34]: MONNA models `permissions.allow`, `.deny`, `.ask`, `.additionalDirectories` and `.defaultMode`, and MCP `mcpServers`. It is "not a security scanner or an effective-permission evaluator". In a first-party comparison dated 2026-09-07, DebadityaHait's tool produced a finding in 4 of 11 changed cases and MONNA in 11 of 11. <https://github.com/emanalshazly/monna-agent-permission-diff> and `docs/THREE-ALTERNATIVE-REVIEW.md`, accessed 2026-09-27.
[^35]: The bot covers MCP and Copilot MCP config, MCP Registry metadata, GitHub Actions permissions, egress policy and instruction files (<https://github.com/saagpatel/agent-permission-diff-bot>). agentcapdiff "statically inventories AI-agent tools" and "diffs capability snapshots across pull requests" (<https://github.com/nqtplus/agentcapdiff>). Accessed 2026-09-27.
[^36]: "RuleBlast shows the blast radius — which files inherit that change across Codex, Claude Code, Gemini CLI, and Copilot CLI." It has `diff <ref>`, and `explain` prints a `PROOF` line. <https://github.com/Kpoiut/ruleblast>, accessed 2026-09-27.
[^37]: settings-effective "prints the merged result with the deciding file next to every key, and lists the silent reasons a setting isn't applying". Its findings include keys in a scope that can't set them, shadowed values, `allow` rules outranked by `ask` or `deny`, typos, and project rules waiting on trust. "It reads files, not the running harness." <https://github.com/Londopy/settings-effective>, accessed 2026-09-27.
[^38]: agent-scan scans "MCP servers, tools, prompts, resources, and skills, and automatically discover[s] supported agent configurations such as Claude Code". `--ci` sets the exit code (<https://github.com/snyk/agent-scan>). It has no base-versus-PR diff, according to agent-assurance's landscape (<https://github.com/kunko-ai-labs/agent-assurance/blob/main/docs/landscape.md>). Accessed 2026-09-27.
[^39]: claudelint validates "CLAUDE.md files, skills, settings, hooks, MCP servers, and plugins". Its settings checks cover "JSON schema, permissions, tool names, hook configuration", and it has `check-all --fix` (<https://github.com/pdugan20/claudelint>). "116 rules across 10 categories" and SARIF output (<https://claudelint.com/>). Accessed 2026-09-27.
[^40]: speckit-gate's "Harness enforcement matrix" marks each agent's user and model invocation channels as deny, none or advisory (<https://pypi.org/project/speckit-gate/>). specforge says the "human approve" step "is advisory" without a hook (<https://github.com/pooyagolchian/specforge>). Accessed 2026-09-27.
[^41]: A keyword count over <https://code.claude.com/docs/en/changelog> (accessed 2026-09-27), covering releases 2.1.251 (2026-08-28) to 2.1.283 (2026-09-25). It counts entries that start with "Changed" or "Added" and mention settings, permissions, hooks, subagents, skills, MCP, CLAUDE.md, AGENTS.md, frontmatter or managed settings.
[^42]: GitHub API, 2026-09-27: agent-assurance 3 stars (created 2026-09-16), agent-pr-reviewer-lite 1 (2026-06-04), agent-permission-diff 0 (2026-08-19), MONNA 0 (2026-09-07), agent-permission-diff-bot 0 (2026-06-20), agentcapdiff 1 (2026-08-21).
[^43]: <https://github.com/kunko-ai-labs/agent-assurance/blob/main/docs/landscape.md>. It was "Checked on 2026-09-17" and is a reading of READMEs; nothing was executed. Accessed 2026-09-27.
[^44]: "Agent Plugins 1.0 is an open standard" from AWS, Anysphere, Microsoft, OpenAI and Vercel, with Google as a core maintainer. Plugins can hold skills, MCP config, custom agents, commands, rules and hooks. <https://github.blog/changelog/2026-08-12-agent-plugins-1-0-in-vs-code-copilot-cli-and-the-copilot-app/>, accessed 2026-09-27.
[^45]: <https://commandline.microsoft.com/agent-hooks-framework-neutral-ai-governance-contract/> and <https://github.com/responsibleai/agent-hooks>, accessed 2026-09-27.
[^46]: "Assisted approvals, now in public preview for Copilot agent sessions, automatically approve low-risk tool calls while prompting you for higher-risk actions." <https://github.blog/changelog/2026-09-25-github-copilot-weekly-releases-september-21/>, accessed 2026-09-27.
[^47]: api.npmjs.org, last month (2026-08-28 to 2026-09-26): rulesync 886,410; `@intellectronica/ruler` 246,239; `ecc-agentshield` 37,190; `agent-permission-diff` 26,994; `claude-code-lint` 21,071; `ruleblast` 569. Accessed 2026-09-27.
