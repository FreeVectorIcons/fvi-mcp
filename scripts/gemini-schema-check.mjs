#!/usr/bin/env node
/**
 * Reports tool schemas and names that fall outside what Gemini function
 * declarations accept (the OpenAPI Schema subset of the Gemini API), using the
 * live schemas returned by the built server against the local fake API. Hosts that pass full JSON
 * Schema through may still work; hosts that convert to the subset may drop or
 * reject these keywords. Pass --strict to exit 1 when anything is reported.
 */
import { readFileSync } from "node:fs";
import { startFakeApi } from "./fake-api.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const api = await startFakeApi();
let tools;
try {
  tools = await api.listTools(join(packageRoot, "dist", "mcp-server.mjs"));
} finally {
  api.close();
}
const dist = JSON.parse(readFileSync(join(packageRoot, "distribution.json"), "utf8"));
const strict = process.argv.includes("--strict");

const SUPPORTED = new Set([
  "type", "format", "title", "description", "nullable", "enum", "maxItems", "minItems",
  "properties", "required", "minProperties", "maxProperties", "minLength", "maxLength",
  "pattern", "example", "anyOf", "propertyOrdering", "default", "items", "minimum", "maximum",
]);
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/;

function findUnsupported(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findUnsupported(item, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (!SUPPORTED.has(key)) out.push(here);
    else if (key === "type" && Array.isArray(value)) out.push(`${here} (type array)`);
    if (key === "properties" && value && typeof value === "object") {
      for (const [prop, schema] of Object.entries(value)) findUnsupported(schema, `${here}.${prop}`, out);
    } else if (key === "items" || key === "anyOf") {
      findUnsupported(value, here, out);
    }
  }
}

let findings = 0;
const keywordCounts = new Map();
for (const tool of tools) {
  const issues = [];
  if (!NAME_PATTERN.test(tool.name)) issues.push(`name "${tool.name}" is not a valid Gemini function name`);
  const paths = [];
  findUnsupported(tool.inputSchema, "inputSchema", paths);
  for (const path of paths) {
    const keyword = path.split(".").pop().replace(/ \(type array\)$/, "[]");
    keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
  }
  issues.push(...paths);
  if (issues.length === 0) continue;
  findings += issues.length;
  console.log(`${tool.name}`);
  for (const issue of issues) console.log(`  ${issue}`);
}

const antigravityServer = `${dist.pluginName}_${dist.serverKey}`;
const longest = tools.reduce((a, b) => (b.name.length > a.name.length ? b : a));
const prefixed = `${antigravityServer}__${longest.name}`;

console.log("");
console.log(`${tools.length} tools checked, ${findings} findings outside the Gemini schema subset`);
if (keywordCounts.size > 0) {
  console.log(`by keyword: ${[...keywordCounts].map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
console.log(
  `Antigravity names the plugin server ${antigravityServer}. If a host prefixes tool names with it, the longest becomes ${prefixed.length} characters (Gemini allows 64).`,
);

if (strict && findings > 0) process.exit(1);
