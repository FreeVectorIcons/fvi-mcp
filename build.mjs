import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const outFile = join(packageRoot, "dist", "mcp-server.mjs");

mkdirSync(dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [join(packageRoot, "src", "mcp-server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: outFile,
  banner: {
    js: "#!/usr/bin/env node",
  },
  logLevel: "info",
});
