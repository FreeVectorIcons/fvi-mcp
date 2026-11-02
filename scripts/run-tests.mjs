#!/usr/bin/env node
/** Bundles each src/**\/*.test.ts with esbuild and runs it with node. */
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(packageRoot, "src");
const tests = readdirSync(srcDir, { recursive: true })
  .filter((file) => String(file).endsWith(".test.ts"))
  .map((file) => join(srcDir, String(file)))
  .sort();

const outDir = mkdtempSync(join(tmpdir(), "fvi-mcp-tests-"));
let failed = 0;
try {
  for (const entry of tests) {
    const outfile = join(outDir, `${relative(srcDir, entry).replaceAll("/", "__")}.mjs`);
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      outfile,
      logLevel: "warning",
    });
    const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
    if (result.status !== 0) failed += 1;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`${failed} of ${tests.length} test files failed`);
  process.exit(1);
}
