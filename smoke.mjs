#!/usr/bin/env node
/**
 * Verifies the published contract: dist/mcp-server.mjs runs with no
 * node_modules for bundled libraries (SDK, zod).
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distFile = join(packageRoot, "dist", "mcp-server.mjs");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length > 0) {
  console.error(
    `smoke failed: published dependencies must be empty (found: ${runtimeDeps.join(", ")})`,
  );
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "fvi-mcp-smoke-"));
const isolatedBin = join(workDir, "mcp-server.mjs");

try {
  copyFileSync(distFile, isolatedBin);

  const child = spawn(process.execPath, [isolatedBin], {
    cwd: workDir,
    env: {
      ...process.env,
      // Force resolution away from the monorepo node_modules tree.
      NODE_PATH: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve) => {
    // Stdio server exits cleanly when stdin is ignored/closed.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, 3000);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  if (stderr.includes("Cannot find package") || stderr.includes("ERR_MODULE_NOT_FOUND")) {
    console.error("smoke failed: bundle still requires external packages\n", stderr);
    process.exit(1);
  }

  if (exitCode !== 0 && exitCode !== null) {
    console.error(`smoke failed: process exited with code ${exitCode}\n`, stderr);
    process.exit(1);
  }

  if (!stderr.includes("server.start")) {
    console.error("smoke failed: missing server.start log on stderr\n", stderr);
    process.exit(1);
  }

  console.log("smoke ok: empty dependencies + standalone dist/mcp-server.mjs");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
