# Harness changelog

Harness fixes are recorded here. The scoring definitions in `../protocol.md` do not change.

## 2026-09-27

- **Pilot 1** (T2, T10; excluded from the count). Every config edit was refused: Claude Code asks before an agent edits `.claude/**` or `.mcp.json`, and a headless run can't answer. Both runs explained the change instead of making it. This led to protocol amendment 1.
- **Probe.** `--allowedTools Edit Write` and `--allowedTools "Edit(./**)" "Write(./**)"` do not override that prompt.
- **Fix.** Added `approver.mjs`, a stdio MCP server wired in with `--permission-prompt-tool mcp__approver__approve`. It approves file tools inside the temporary repository, denies everything else, and logs each prompt.
- **Pilot 2.** The approver denied edits whose path used `/private/var/...`, because macOS `/var` is a symlink. The agent retried with `/var/...` and succeeded. Fixed: the approver resolves real paths.
- **Pilot 3** (kept in `results/pilot/`). No denials, and both runs scored ok.
- **Scorer.** Tested against synthetic broken runs: an unrequested allow rule, a removed deny rule, invalid JSON, a dropped frontmatter key, a dangling skill reference, a dangling agent MCP reference, and an extra allow rule next to a correct hook. Each was flagged with the right code. An invalid settings file now counts only as F1.
- **Known discrepancy (found by the H3 teardown, after the baseline run).** F1 treats a skill that lacks `name` or `description`, or whose `name` differs from its directory, as invalid. The protocol wording follows the Agent Skills spec, but the current Claude Code docs make `name` optional and `description` only recommended. No baseline run triggered this rule, so the results are unchanged. Any future run should score it under an amendment that follows the Claude Code docs.
- **Found during release prep (2026-09-27): the fixtures' allow rules were not in force.** Every run's `stderr.txt` says Claude Code ignored the fixture's `permissions.allow` entries, because the temporary workspace had never been trusted. This doesn't change the scored result:
  - the benchmark scores file edits, and the approver handled those;
  - allow rules don't gate file edits;
  - Bash wasn't available.

  But the fixtures' allow rules weren't active during the runs.
