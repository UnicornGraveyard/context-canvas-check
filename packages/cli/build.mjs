// Bundles the CLI (core and yaml included) into one plain-Node file, and the
// MCP server into a second one that the CLI loads only for `mcp`, so checks
// and hooks don't parse the MCP SDK. Both are copied into the Claude Code
// plugin, so the plugin needs nothing installed.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // yaml's CommonJS build calls require(); give the ESM bundles one.
  banner: { js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);' },
};

/** `import("./mcp")` in cli.ts loads the MCP bundle next to it at run time. */
const mcpBesideCli = {
  name: "mcp-beside-cli",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\/mcp$/ }, () => ({ path: "./mcp.mjs", external: true }));
  },
};

await build({
  ...common,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/context-canvas.mjs",
  banner: { js: `#!/usr/bin/env node\n${common.banner.js}` },
  plugins: [mcpBesideCli],
});
await build({ ...common, entryPoints: ["src/mcp.ts"], outfile: "dist/mcp.mjs" });

mkdirSync("plugin/bin", { recursive: true });
for (const file of ["context-canvas.mjs", "mcp.mjs"]) copyFileSync(`dist/${file}`, `plugin/bin/${file}`);
console.log("built dist/ and plugin/bin/: context-canvas.mjs and mcp.mjs");
