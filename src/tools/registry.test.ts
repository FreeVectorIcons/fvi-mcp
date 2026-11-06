import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_TOOL_LIMITS,
  LEGACY_TOOL_NAMES,
  TOOL_DEFINITIONS,
  acceptLegacyToolNames,
  canonicalizeToolCalls,
  registerTools,
  type FviApiClient,
  type ToolHost,
} from "./index.js";

type Call = { method: string; path: string; body?: unknown; label: string };

function fakeApi(calls: Call[]): FviApiClient {
  const respond = async <T>(call: Call): Promise<T> => {
    calls.push(call);
    if (call.path.endsWith("/assets/uploads")) {
      return { asset: { id: "ast_1" }, collectionItemId: "itm_1", versionId: "ver_1", upload: { url: "/upload", method: "PUT" } } as T;
    }
    return { ok: true } as T;
  };
  return {
    get: (path, label) => respond({ method: "GET", path, label }),
    post: (path, body, label) => respond({ method: "POST", path, body, label }),
    put: (path, body, label) => respond({ method: "PUT", path, body, label }),
    patch: (path, body, label) => respond({ method: "PATCH", path, body, label }),
    delete: (path, label) => respond({ method: "DELETE", path, label }),
    upload: async (target, body, label) => {
      calls.push({ method: "UPLOAD", path: target.url, body: body.byteLength, label });
    },
    collectionPath: async (path) => `/mcp/collections/col_test${path}`,
  };
}

async function connect(host: ToolHost, onLegacyName?: (name: string) => void) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, host, TOOL_DEFINITIONS, { includeWrites: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  acceptLegacyToolNames(serverTransport, onLegacyName);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function inputKeys(tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>, name: string) {
  return Object.keys(tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {});
}

{
  const calls: Call[] = [];
  const local = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS, readLocalFile: async () => Buffer.from("x") });
  const remote = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS });
  const localTools = (await local.listTools()).tools;
  const remoteTools = (await remote.listTools()).tools;

  assert.equal(localTools.length, TOOL_DEFINITIONS.length);
  assert.deepEqual(remoteTools.map((tool) => tool.name), localTools.map((tool) => tool.name));
  for (const name of ["park_asset", "create_asset_version", "create_asset_version_upload"]) {
    assert.ok(inputKeys(localTools, name).includes("filePath"), `${name} keeps filePath locally`);
    assert.ok(!inputKeys(remoteTools, name).includes("filePath"), `${name} drops filePath without a local file reader`);
  }
  const unchanged = localTools.filter((tool) => !inputKeys(localTools, tool.name).includes("filePath"));
  for (const tool of unchanged) {
    assert.deepEqual(remoteTools.find((other) => other.name === tool.name), tool, `${tool.name} schema is identical`);
  }
}

{
  const calls: Call[] = [];
  const client = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS });
  await client.callTool({ name: "get_asset", arguments: { assetId: "ast_1" } });
  assert.deepEqual(calls, [{ method: "GET", path: "/mcp/collections/col_test/assets/ast_1", label: "get_asset" }]);
}

{
  const calls: Call[] = [];
  const client = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS });
  const result = await client.callTool({
    name: "park_asset",
    arguments: { name: "DESIGN.md", contentType: "text/markdown", textContent: "# Brand" },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.label}`), [
    "POST park_asset",
    "UPLOAD park_asset",
    "POST complete_asset_upload",
  ]);
  assert.equal(calls[1]?.body, Buffer.byteLength("# Brand"));
}

{
  const calls: Call[] = [];
  const client = await connect({ api: fakeApi(calls), limits: { ...DEFAULT_TOOL_LIMITS, maxUploadBytes: 4 } });
  const result = await client.callTool({
    name: "park_asset",
    arguments: { name: "DESIGN.md", contentType: "text/markdown", textContent: "# Brand" },
  });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /exceeds the 4 byte limit/);
  assert.equal(calls.length, 0, "host upload limit applies before any API call");
}

{
  const calls: Call[] = [];
  const client = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS });
  const result = await client.callTool({
    name: "park_asset",
    arguments: { name: "a.svg", contentType: "image/svg+xml", filePath: "/etc/passwd" },
  });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0, "filePath is never read on a host without a local file reader");
}

{
  const names = TOOL_DEFINITIONS.map((definition) => definition.name);
  const prefix = "freevectoricons_freevectoricons__";
  assert.equal(names.length, 26);
  assert.equal(new Set(names).size, names.length, "tool names are unique");
  for (const name of names) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is lowercase snake_case`);
    assert.ok(prefix.length + name.length <= 64, `${name} fits 64 characters with the observed client prefix`);
  }
  const legacy = Object.keys(LEGACY_TOOL_NAMES);
  assert.equal(legacy.length, 23, "every renamed tool has a legacy alias");
  for (const [oldName, newName] of Object.entries(LEGACY_TOOL_NAMES)) {
    assert.ok(names.includes(newName), `${oldName} maps to a registered tool`);
    assert.ok(!names.includes(oldName), `${oldName} is not registered`);
  }
  for (const unchanged of ["get_community_pack_guide", "list_community_packs", "set_collection_design_md"]) {
    assert.ok(names.includes(unchanged) && !Object.values(LEGACY_TOOL_NAMES).includes(unchanged), `${unchanged} keeps its name`);
  }
}

{
  const calls: Call[] = [];
  const used: string[] = [];
  const client = await connect({ api: fakeApi(calls), limits: DEFAULT_TOOL_LIMITS }, (name) => used.push(name));
  const listed = (await client.listTools()).tools.map((tool) => tool.name);
  for (const oldName of Object.keys(LEGACY_TOOL_NAMES)) {
    assert.ok(!listed.includes(oldName), `${oldName} is never listed`);
  }
  const result = await client.callTool({ name: "get_design_asset", arguments: { assetId: "ast_1" } });
  assert.equal(result.isError, undefined, "a legacy name still dispatches");
  assert.deepEqual(calls, [{ method: "GET", path: "/mcp/collections/col_test/assets/ast_1", label: "get_asset" }]);
  assert.deepEqual(used, ["get_design_asset"]);

  const unknown = await client.callTool({ name: "get_design_thing", arguments: {} }).catch((error: Error) => error);
  assert.ok(
    unknown instanceof Error ? /not found/.test(unknown.message) : unknown.isError === true,
    "names outside the alias map are still unknown",
  );
}

{
  const batch = [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_design_asset_transcription_status" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_asset" } },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
  ];
  assert.deepEqual(canonicalizeToolCalls(batch), ["update_design_asset_transcription_status"]);
  assert.equal(batch[0]?.params?.name, "set_asset_transcription_status");
  assert.equal(batch[1]?.params?.name, "get_asset");
  assert.deepEqual(canonicalizeToolCalls({ method: "tools/call", params: { name: "toString" } }), [], "prototype keys are not aliases");
}

console.log("fvi-mcp tool registry tests passed");
