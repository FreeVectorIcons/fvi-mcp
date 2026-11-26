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

const expectedText = readFileSync(snapshotFile, "utf8");
if (expectedText !== serialized) {
  console.error("contract failed: tool list or schemas changed.");
  reportContractDiff(JSON.parse(expectedText), actual);
  console.error("If the change is intended, run: node ./scripts/contract.mjs --update");
  process.exit(1);
}
console.log(`contract ok: ${actual.full.length} tools (${actual.readOnly.length} read-only)`);

function fmt(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}

function fmtChange(expected, actual) {
  if (typeof expected === "string" && typeof actual === "string" && (expected.length > 80 || actual.length > 80)) {
    let i = 0;
    const limit = Math.min(expected.length, actual.length);
    while (i < limit && expected[i] === actual[i]) i++;
    const start = Math.max(0, i - 20);
    const clip = (value) => {
      const body = value.slice(start, Math.max(i + 60, start + 80));
      return `${start > 0 ? "..." : ""}${body}${start + body.length < value.length ? "..." : ""}`;
    };
    return `expected ${JSON.stringify(clip(expected))}, actual ${JSON.stringify(clip(actual))}`;
  }
  return `expected ${fmt(expected)}, actual ${fmt(actual)}`;
}

function fieldDiffs(expected, actual, path = "") {
  if (Object.is(expected, actual) || JSON.stringify(expected) === JSON.stringify(actual)) return [];
  const expObj = expected !== null && typeof expected === "object";
  const actObj = actual !== null && typeof actual === "object";
  if (!expObj || !actObj || Array.isArray(expected) !== Array.isArray(actual)) {
    return [`${path || "(root)"}: ${fmtChange(expected, actual)}`];
  }
  if (Array.isArray(expected)) {
    return [`${path || "(root)"}: ${fmtChange(expected, actual)}`];
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const diffs = [];
  for (const key of keys) {
    const next = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(expected, key)) diffs.push(`${next}: added ${fmt(actual[key])}`);
    else if (!Object.hasOwn(actual, key)) diffs.push(`${next}: removed ${fmt(expected[key])}`);
    else diffs.push(...fieldDiffs(expected[key], actual[key], next));
  }
  return diffs;
}

function namesOf(list) {
  return list.map((item) => (typeof item === "string" ? item : item.name));
}

function reportNamedList(label, expected, actual) {
  const expNames = namesOf(expected);
  const actNames = namesOf(actual);
  const expSet = new Set(expNames);
  const actSet = new Set(actNames);
  const removed = expNames.filter((name) => !actSet.has(name));
  const added = actNames.filter((name) => !expSet.has(name));
  const expectedByName = new Map(expected.map((item, i) => [expNames[i], item]));
  const actualByName = new Map(actual.map((item, i) => [actNames[i], item]));
  const changed = [];
  if (expected.length && typeof expected[0] !== "string") {
    for (const name of expNames) {
      if (!actualByName.has(name)) continue;
      const diffs = fieldDiffs(expectedByName.get(name), actualByName.get(name));
      if (diffs.length) changed.push({ name, diffs });
    }
  } else if (JSON.stringify(expected) !== JSON.stringify(actual) && !removed.length && !added.length) {
    changed.push({
      name: "(order)",
      diffs: [`expected ${fmt(expected)}, actual ${fmt(actual)}`],
    });
  }
  if (!removed.length && !added.length && !changed.length) return false;
  console.error(`${label}:`);
  if (removed.length) console.error(`  removed: ${removed.join(", ")}`);
  if (added.length) console.error(`  added: ${added.join(", ")}`);
  for (const { name, diffs } of changed) {
    console.error(`  ${name}`);
    for (const line of diffs) console.error(`    ${line}`);
  }
  return true;
}

function reportContractDiff(expected, actual) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  let reported = false;
  for (const key of keys) {
    if (!Object.hasOwn(expected, key)) {
      console.error(`${key}: added ${fmt(actual[key])}`);
      reported = true;
      continue;
    }
    if (!Object.hasOwn(actual, key)) {
      console.error(`${key}: removed ${fmt(expected[key])}`);
      reported = true;
      continue;
    }
    if (Array.isArray(expected[key]) && Array.isArray(actual[key])) {
      reported = reportNamedList(key, expected[key], actual[key]) || reported;
      continue;
    }
    const diffs = fieldDiffs(expected[key], actual[key], key);
    if (diffs.length) {
      for (const line of diffs) console.error(line);
      reported = true;
    }
  }
  if (!reported) {
    console.error("Snapshots differ, but no structured field diff was produced (check whitespace or key order).");
  }
}
