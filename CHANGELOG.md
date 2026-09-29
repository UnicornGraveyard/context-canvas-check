# Changelog

## 0.1.0

First release. Checks whether a Claude Code configuration actually applies:

- agent files Claude Code skips, and agent fields it ignores;
- skill `agent:` references that don't resolve;
- project settings in a parent folder, which aren't loaded;
- MCP servers both enabled and disabled;
- allow rules for protected paths;
- single-slash rule paths that aren't absolute;
- ask rules a PreToolUse hook can't override;
- subfolder CLAUDE.md files that load only on demand;
- changes to hooks, rules, MCP servers and agents since the last baseline.

Every finding says what won't apply, why, the fix and the docs link, and gives the exact line edit where the fix is mechanical. `--prompt` turns the findings into instructions for a coding agent.

It ships as a CLI (`npx context-canvas-check`), a Claude Code plugin, and an MCP server for any agent (`npx -y context-canvas-check mcp`: `check_config`, `get_fix_instructions`, `explain_check`). The rules for which files Claude Code reads are shared with the browser check at contextcanvas.ai/check, and a parity test checks that both read the same files.
