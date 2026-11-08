#!/usr/bin/env node
/**
 * Tool contract check: runs dist/mcp-server.mjs against a local fake API that
 * grants every scope and capability, lists tools over stdio, and compares the
 * result with scripts/tools-contract.json. Pass --update to rewrite the snapshot.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeApi } from "./fake-api.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distFile = join(packageRoot, "dist", "mcp-server.mjs");
const snapshotFile = join(packageRoot, "scripts", "tools-contract.json");
const update = process.argv.includes("--update");

const api = await startFakeApi();
const listTools = (extraEnv, runFlags) => api.listTools(distFile, extraEnv, runFlags);

const actual = {
  full: await listTools({}),
  readOnly: await listTools({ FVI_READ_ONLY: "true" }),
  recordsToolsOff: (await listTools({}, { "mcp.records_tools": false })).map((tool) => tool.name),
  recordsDataOff: (await listTools({}, { "collections.records": false })).map((tool) => tool.name),
};
api.close();

const serialized = `${JSON.stringify(actual, null, 2)}\n`;
if (update) {
  writeFileSync(snapshotFile, serialized);
  console.log(`contract snapshot written: ${actual.full.length} tools (${actual.readOnly.length} read-only)`);
  process.exit(0);
}

// Keep the main snapshot (names, arguments and gating) unchanged. The only
// intentional wire difference is removal of SDK JSON Schema declarations for
// Gemini; normalize the saved baseline only so a wire regression still fails.
function withoutSchemaDeclarations(value) {
  if (Array.isArray(value)) return value.map(withoutSchemaDeclarations);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "$schema")
    .map(([key, child]) => [key, withoutSchemaDeclarations(child)]));
}
const expected = `${JSON.stringify(withoutSchemaDeclarations(JSON.parse(readFileSync(snapshotFile, "utf8"))), null, 2)}\n`;
if (expected !== serialized) {
  const names = (list) => list.map((tool) => tool.name).join(", ");
  console.error("contract failed: tool list or schemas changed.");
  console.error(`expected full: ${names(JSON.parse(expected).full)}`);
  console.error(`actual full:   ${names(actual.full)}`);
  console.error("If the change is intended, run: node ./scripts/contract.mjs --update");
  process.exit(1);
}
console.log(`contract ok: ${actual.full.length} tools (${actual.readOnly.length} read-only)`);
