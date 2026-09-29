# context-canvas-check

**Does your Claude Code configuration actually apply?**

Claude Code silently skips an agent file whose frontmatter is broken. It ignores a misspelled field, and it never loads project settings from a parent folder. `context-canvas-check` finds these, tells you what won't apply and why, and gives your coding agent the fixes: as a prompt, through a Claude Code plugin, or as an MCP server any agent can call.

```sh
npx context-canvas-check
```

From a real repository:

```text
context-canvas-check · ~/code/my-project
76 errors, 28 notes

ERROR  Agent file Claude Code skips: 67 files
  Why: YAML error: the frontmatter block is not closed with ---.
  Fix: Add a closing --- line after the last frontmatter field.
  Docs: https://code.claude.com/docs/en/sub-agents
  Files:
    .claude/agents/analysis/code-analyzer.md
    ...

28 notes not shown (28 × Agent frontmatter field Claude Code ignores). Add --notes to list them.
```

## What it checks

| Check | What won't apply |
|---|---|
| `agent-not-loaded` | Agent files Claude Code skips: frontmatter that doesn't parse or isn't closed, `---` not on line 1, a name with `:`, no description, `hooks` written as a list |
| `agent-unknown-field` | Agent fields Claude Code ignores, such as `allowed-tools` where `tools` is meant, which leaves the agent with every tool |
| `agent-reference-unresolved` | A skill's `agent:` that doesn't resolve, including bare names for plugin agents, which are namespaced |
| `settings-in-parent-folder` | `.claude/settings.json` in a parent folder, which isn't loaded when a session starts in a subfolder |
| `mcp-enabled-and-disabled` | An MCP server listed as both enabled and disabled; disabled wins |
| `allow-rule-protected-path` | Allow rules for protected paths (`.claude/`, `.git/`, `.husky/`, `.zshrc`, ...), which pre-approve nothing |
| `single-slash-path` | `Read(/Users/...)`: one leading slash anchors at the settings source, not the filesystem root |
| `ask-rule-overrides-hook` | Ask rules that still prompt when a PreToolUse hook allows the call |
| `nested-claude-md` | Subfolder CLAUDE.md files, which load only after Claude reads a file in that folder |
| `config-drift` | Hooks, permission rules, MCP servers and agents added, removed or changed since your last baseline |

**Every check traces to evidence.** Each one maps to a public report of someone hit by the problem, and to Claude Code's documentation, linked in every finding. We tested whether this was worth building before building it: see the [two pre-registered studies](docs/research/).

## Fix it with your coding agent

```sh
npx context-canvas-check --prompt | pbcopy
```

`--prompt` turns the findings into instructions for Claude Code, Cursor or any other coding agent. Each problem comes with why, the fix and the docs link. Where the fix is mechanical, the exact edit (`on line 4, replace allowed-tools: Read, Grep with tools: Read, Grep`); where it's a choice, an instruction to ask first. No model writes the prompt: it's built from the findings by fixed rules, so the same findings always give the same text.

## In Claude Code

```text
/plugin marketplace add ianmacdowell13-byte/context-canvas-check
/plugin install context-canvas-check@context-canvas
```

The plugin:
- checks at session start, and tells Claude about errors and drift;
- checks each config file Claude edits. When the edit won't apply, Claude sees why and fixes it;
- adds the MCP server below, so Claude can check the project and get the fixes when asked.

## For any agent: the MCP server

```sh
npx -y context-canvas-check mcp
```

Three read-only tools over stdio: `check_config` (findings as JSON, with exact edits), `get_fix_instructions` (the fix prompt, ending with "call check_config again to confirm") and `explain_check`. Without a `path`, they check the client's workspace root. They change nothing, not even the drift baseline, and send nothing.

| Client | Setup |
|---|---|
| Claude Code | `claude mcp add context-canvas-check -- npx -y context-canvas-check mcp` |
| Cursor | `.cursor/mcp.json`: `{"mcpServers": {"context-canvas-check": {"command": "npx", "args": ["-y", "context-canvas-check", "mcp"]}}}` |
| VS Code | `.vscode/mcp.json`: `{"servers": {"context-canvas-check": {"type": "stdio", "command": "npx", "args": ["-y", "context-canvas-check", "mcp"]}}}` |
| Codex | `~/.codex/config.toml`: `[mcp_servers.context-canvas-check]` with `command = "npx"` and `args = ["-y", "context-canvas-check", "mcp"]` |

## In CI

```sh
npx context-canvas-check --no-user --strict
```

**Exit codes:** 0 with no errors, 1 with errors (or with warnings under `--strict`), 2 for usage errors. Add `--json` for machine-readable output.

## Privacy

- **Local only.** The CLI, the plugin and the MCP server read files on your machine and send nothing anywhere.
- **The drift baseline** lives in `~/.context-canvas/`. It holds rule names, hook commands and hashes, never secret values.

## Limits

- **Claude Code only.**
- **No managed settings or runtime state.** Use `/status`, `/hooks` and `/context` in a session for what actually loaded.
- **Behavior can change.** Rules reflect Claude Code's documentation as of v2.1.283.

## Repository

| Path | What |
|---|---|
| `packages/cli` | The CLI, the MCP server and the Claude Code plugin |
| `packages/core` | The checks, as pure functions |
| `docs/research` | The evidence behind every check |

Licensed under Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
