import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_TOOL_LIMITS, TOOL_DEFINITIONS, registerTools, type ToolHost } from "./index.js";

function assertNoSchemaDeclaration(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoSchemaDeclaration);
    return;
  }
  assert.ok(!Object.hasOwn(value, "$schema"), "wire schemas omit $schema for Gemini");
  Object.values(value).forEach(assertNoSchemaDeclaration);
}

for (const local of [false, true]) {
  for (const includeWrites of [false, true]) {
    const server = new McpServer({ name: "schema-test", version: "0.0.0" });
    const host = {
      api: {}, limits: DEFAULT_TOOL_LIMITS,
      ...(local ? { readLocalFile: async () => Buffer.from("x") } : {}),
    } as ToolHost;
    // Multiple registration batches must retain every handler and schema.
    registerTools(server, host, TOOL_DEFINITIONS.slice(0, 3), { includeWrites });
    registerTools(server, host, TOOL_DEFINITIONS.slice(3), { includeWrites });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "schema-client", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const expected = TOOL_DEFINITIONS.filter((tool) => includeWrites || tool.scope === "read");
      assert.deepEqual(tools.map((tool) => tool.name), expected.map((tool) => tool.name));
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, "object");
        assertNoSchemaDeclaration(tool.inputSchema);
        assertNoSchemaDeclaration(tool.outputSchema);
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
}
console.log("fvi-mcp schema compatibility tests passed");
