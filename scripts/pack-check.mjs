#!/usr/bin/env node
/**
 * Clean-install check: packs the package, installs the tarball into an empty
 * directory and confirms every tool in scripts/tools-contract.json loads from
 * the installed copy. Registry and store listings are gated on this passing.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeApi } from "./fake-api.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(packageRoot, "scripts", "tools-contract.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  console.error(`pack-check failed: ${message}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "fvi-mcp-pack-"));
const api = await startFakeApi();
try {
  const [packed] = JSON.parse(
    execFileSync(npm, ["pack", "--json", "--pack-destination", workDir], { cwd: packageRoot, encoding: "utf8" }),
  );
  const files = packed.files.map((file) => file.path);
  for (const required of ["package.json", "dist/mcp-server.mjs"]) {
    if (!files.includes(required)) fail(`tarball is missing ${required}`);
  }

  const installDir = join(workDir, "consumer");
  mkdirSync(installDir);
  writeFileSync(join(installDir, "package.json"), JSON.stringify({ name: "fvi-mcp-consumer", private: true }));
  execFileSync(npm, ["install", join(workDir, packed.filename), "--no-audit", "--no-fund", "--ignore-scripts"], {
    cwd: installDir,
    stdio: "ignore",
  });

  const installedRoot = join(installDir, "node_modules", ...pkg.name.split("/"));
  const serverFile = join(installedRoot, pkg.bin["fvi-mcp"]);
  if (lstatSync(serverFile).isSymbolicLink()) fail(`${pkg.bin["fvi-mcp"]} is a symlink in the installed package`);

  const tools = (await api.listTools(serverFile)).map((tool) => tool.name);
  const expected = contract.full.map((tool) => tool.name);
  const missing = expected.filter((name) => !tools.includes(name));
  const extra = tools.filter((name) => !expected.includes(name));
  if (missing.length > 0) fail(`installed package is missing tools: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`installed package has tools not in the contract: ${extra.join(", ")}`);

  console.log(`pack-check ok: ${packed.filename} (${files.length} files) installs cleanly with ${tools.length} tools`);
} finally {
  api.close();
  rmSync(workDir, { recursive: true, force: true });
}
