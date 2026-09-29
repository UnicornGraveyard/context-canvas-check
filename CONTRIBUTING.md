# Contributing

Thanks for helping. Two rules keep this tool trustworthy.

1. **Every check traces to evidence.** A new check needs a public report of someone hit by the problem (an issue, forum post or discussion) and the Claude Code documentation that establishes the behavior. Put both in the pull request. The evidence behind v0.1 is in [`docs/research/`](docs/research/).
2. **No false alarms on correct config.** Add a test that reproduces the problem and one that shows a correct configuration passes.

## Develop

```sh
pnpm install
pnpm test        # core checks and CLI end to end
pnpm build       # bundles the CLI into packages/cli/dist and the plugin
node packages/cli/dist/context-canvas.mjs --cwd path/to/project
```

- `packages/core/src/config/` holds the checks, as pure functions with no Node APIs.
- `packages/cli/` holds file discovery, the baseline, output and the plugin.

Commit the rebuilt plugin bundle (`packages/cli/plugin/bin/`) with any source change; CI checks it matches.

This repository is exported from the private Context Canvas monorepo, where development also happens. Pull requests here are welcome and get ported across.
