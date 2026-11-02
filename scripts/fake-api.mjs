/**
 * A local stand-in for the FVI API that grants every scope and capability, and
 * a helper that lists tools from a built server over stdio against it.
 */
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ALL_SCOPES = ["read", "write:assets", "write:collection", "write:records", "delete"];
const ALL_CAPABILITIES = {
  designMd: true,
  purpose: true,
  versionUpload: true,
  versionHistory: true,
  batchDownloadUrls: true,
};

export async function startFakeApi() {
  let flags = {};
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/feature-flags") {
      res.end(JSON.stringify({ flags }));
      return;
    }
    if (req.url === "/mcp/whoami") {
      res.end(JSON.stringify({
        tokenId: "tok_contract",
        collectionId: "col_contract",
        tokenKind: "collection",
        scopes: ALL_SCOPES,
        capabilities: ALL_CAPABILITIES,
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;

  async function listTools(serverFile, extraEnv = {}, runFlags = {}) {
    flags = runFlags;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverFile],
      env: {
        PATH: process.env.PATH ?? "",
        FVI_API_URL: apiUrl,
        FVI_TOKEN: `fvi_col_${"a".repeat(43)}`,
        FVI_LOG_LEVEL: "error",
        ...extraEnv,
      },
      stderr: "ignore",
    });
    const client = new Client({ name: "fvi-mcp-contract", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      return tools;
    } finally {
      await client.close();
    }
  }

  return { listTools, close: () => server.close() };
}
