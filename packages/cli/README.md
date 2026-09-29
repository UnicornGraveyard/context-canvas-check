# context-canvas-check

**Does your Claude Code configuration actually apply?** `context-canvas-check` reports:
- agent files Claude Code skips;
- settings it ignores;
- rules that don't protect what they look like they protect;
- hooks, permissions and MCP servers that changed since you last looked.

Most of these fail silently in Claude Code itself.

v0.1 includes only checks that trace to a verified public report of the problem ([research](../../docs/research/option-c/summary.md)). Each finding states documented Claude Code behavior and links to the docs.

## What it checks

| Check | What won't apply | Report |
|---|---|---|
| `agent-not-loaded` | Agent files Claude Code skips: unparseable or unclosed frontmatter, `---` not on line 1, a name with `:` or a leading `-`, a name without a description, `hooks` written as a list | R16 |
| `agent-unknown-field` | Agent fields Claude Code ignores, such as `allowed-tools` where `tools` is meant (which leaves the agent with every tool), and camelCase near misses | R11 |
| `agent-reference-unresolved` | A skill's `agent:` that doesn't resolve, including bare names for plugin agents, which are namespaced (`plugin:agent`) | R12 |
| `settings-in-parent-folder` | `.claude/settings.json` in a parent folder, which isn't loaded when a session starts in a subfolder | R09 |
| `mcp-enabled-and-disabled` | An MCP server in both `enabledMcpjsonServers` and `disabledMcpjsonServers`; disabled wins | R07 |
| `allow-rule-protected-path` | Allow rules for protected paths (`.claude/`, `.git/`, `.husky/`, `.zshrc`, ...), which can't pre-approve writes | R10 |
| `single-slash-path` | `Read(/Users/...)` and similar: one leading slash anchors at the settings source, not the filesystem root | R39 |
| `ask-rule-overrides-hook` | Ask rules that still prompt even when a PreToolUse hook allows the call | R37 |
| `nested-claude-md` | Subfolder CLAUDE.md files, which load only after Claude reads a file in that folder | R41 |
| `config-drift` | Hooks, permission rules, MCP servers, agents and settings keys added, removed or changed since the last baseline | R06, R36, R40 |
| `file-does-not-parse` | Settings, MCP and skill files that don't parse, so they're ignored | R04 |

It reads what Claude Code reads for a session started in the chosen folder:
- `.claude/settings.json`, agents, skills, rules and commands from that folder;
- `.claude/settings.local.json` from the repository root;
- `.mcp.json`;
- CLAUDE.md and AGENTS.md;
- `~/.claude` (unless `--no-user`);
- a plugin layout, when the folder has `.claude-plugin/plugin.json`.

## Use it

```sh
npx context-canvas-check
```

`check` is the only command, so it's also the default.

| Option | |
|---|---|
| `--cwd <dir>` | The folder a Claude Code session would start in (default: the current folder) |
| `--json` | Machine-readable output, for agents and CI |
| `--prompt` | A prompt that asks a coding agent to fix the errors and warnings |
| `--notes` | Also list notes: things that apply, with a caveat |
| `--no-user` | Skip `~/.claude` |
| `--update-baseline` | Record the current configuration for drift tracking |
| `--strict` | Exit 1 on warnings too |

**Exit codes:** 0 when there are no errors, 1 when there are errors (or warnings with `--strict`), 2 for usage errors.

## Fix it with your coding agent

`--prompt` prints the findings as instructions for Claude Code, Cursor or any other coding agent: each problem with why, the fix, and the docs link. Where the fix is mechanical, it gives the exact edit, such as `on line 4, replace allowed-tools: Read, Grep with tools: Read, Grep`. Where the fix is a choice, it tells the agent to ask first.

```sh
npx context-canvas-check --prompt | pbcopy
```

The prompt is built from the findings by fixed rules; no model writes it, and the same findings always give the same text. Text quoted from your files is kept to one line and marked as data, not instructions.

## For agents: the MCP server

`npx -y context-canvas-check mcp` runs the checker as an MCP server over stdio. The tools only read files; they change nothing (not even the drift baseline) and send nothing.

| Tool | |
|---|---|
| `check_config` | The findings for a project, as JSON: file, line, why, fix, exact edit, docs |
| `get_fix_instructions` | The fix prompt above, ending with "call check_config again to confirm" |
| `explain_check` | What a check catches, its docs and the public reports behind it |

Without a `path`, the tools check the client's first workspace root, or else the folder the server started in.

**Claude Code:**

```sh
claude mcp add context-canvas-check -- npx -y context-canvas-check mcp
```

**Cursor** (`.cursor/mcp.json`) and other clients that use `mcpServers`:

```json
{ "mcpServers": { "context-canvas-check": { "command": "npx", "args": ["-y", "context-canvas-check", "mcp"] } } }
```

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "context-canvas-check": { "type": "stdio", "command": "npx", "args": ["-y", "context-canvas-check", "mcp"] } } }
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.context-canvas-check]
command = "npx"
args = ["-y", "context-canvas-check", "mcp"]
```

## As a Claude Code plugin

```text
/plugin marketplace add ianmacdowell13-byte/context-canvas-check
/plugin install context-canvas-check@context-canvas
```

The plugin adds two hooks and the MCP server:
- **SessionStart** tells Claude about errors and warnings, including drift since the last session.
- **PostToolUse** on `Edit|Write|MultiEdit`: when Claude edits a config file, it checks that file and returns exit code 2 with the problems, so Claude fixes them.
- **The MCP server**, so Claude can check the project and get fix instructions when asked.

To try it from a checkout: `pnpm build`, then `claude --plugin-dir packages/cli/plugin`.

## Privacy

- **Local only.** Everything runs on your machine and nothing is sent anywhere.
- **The baseline** lives in `~/.context-canvas/baselines/`. It records rule names and hook commands, and only hashes of MCP server configs and agent frontmatter, never secret values.

## Limits

- **Claude Code only.**
- **No managed settings**, and no runtime state (use `/status`, `/hooks` and `/context` for what loaded in a live session).
- **Behavior can change.** Each rule reflects Claude Code's documentation as of 2026-09-27 (v2.1.283).
