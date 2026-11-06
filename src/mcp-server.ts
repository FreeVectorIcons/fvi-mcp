import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { collectionPath, resolveWhoami } from "./collection-resolve.js";
import { fviDelete, fviGet, fviPatch, fviPost, fviPut, uploadBody } from "./http-client.js";
import { readOptInUploadFile } from "./local-files.js";
import { logger } from "./logger.js";
import { classifyFviToken } from "./token-shape.js";
import {
  TOOL_DEFINITIONS,
  acceptLegacyToolNames,
  canonicalToolName,
  registerTools,
  type RegisteredToolEntry,
  type ToolHost,
} from "./tools/index.js";

const tokenProblem = classifyFviToken(config.token, config.skipTokenCheck);
if (tokenProblem) {
  logger.error("token.rejected", { code: tokenProblem.code, message: tokenProblem.message });
  process.exit(1);
}

const server = new McpServer({
  name: "freevectoricons",
  version: "0.3.0-beta.2",
});

const host: ToolHost = {
  api: {
    get: fviGet,
    post: fviPost,
    put: fviPut,
    patch: fviPatch,
    delete: fviDelete,
    upload: uploadBody,
    collectionPath,
  },
  limits: {
    maxSearchQueryLength: config.maxSearchQueryLength,
    maxAssetIdLength: config.maxAssetIdLength,
    maxUploadBytes: config.maxUploadBytes,
  },
  readLocalFile: readOptInUploadFile,
};

const FEATURE_FLAG_FETCH_TIMEOUT_MS = 3_000;

/**
 * Hides records tools the API would refuse anyway. Fails open: if the flag
 * endpoint is unreachable every tool stays listed and the API remains the gate.
 */
async function applyFeatureFlags(tools: RegisteredToolEntry[]): Promise<void> {
  try {
    const res = await fetch(`${config.apiUrl}/feature-flags`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FEATURE_FLAG_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { flags?: Record<string, unknown> };
    const flags = body.flags ?? {};
    const recordsToolsOn = flags["mcp.records_tools"] !== false;
    const recordsDataOn = recordsToolsOn && flags["collections.records"] !== false;
    for (const { definition, tool } of tools) {
      if (definition.group === "records" && !recordsToolsOn) tool.disable();
      if (definition.group === "recordsData" && !recordsDataOn) tool.disable();
    }
    logger.info("feature_flags.applied", { recordsTools: recordsToolsOn, recordsData: recordsDataOn });
  } catch (error) {
    logger.warn("feature_flags.unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function applyAccessGates(tools: RegisteredToolEntry[]): Promise<void> {
  let whoami: Awaited<ReturnType<typeof resolveWhoami>> | null = null;
  try {
    whoami = await resolveWhoami();
  } catch (error) {
    logger.warn("collection.resolve_deferred", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const scopes = Array.isArray(whoami?.scopes) ? whoami.scopes : null;
  const capabilities = whoami?.capabilities ?? null;
  const allow = new Set(config.toolAllowlist.map(canonicalToolName));
  for (const { definition, tool } of tools) {
    if (config.readOnly && definition.scope !== "read") tool.disable();
    if (scopes && !scopes.includes(definition.scope)) tool.disable();
    if (definition.capability && (!capabilities || capabilities[definition.capability] !== true)) tool.disable();
    if (allow.size > 0 && !allow.has(definition.name)) tool.disable();
  }
}

logger.info("server.start", {
  readOnly: config.readOnly,
  timeoutMs: config.timeoutMs,
  uploadTimeoutMs: config.uploadTimeoutMs,
  retryMax: config.retryMax,
  hasCollectionIdEnv: Boolean(config.collectionId),
});

const tools = registerTools(server, host, TOOL_DEFINITIONS, { includeWrites: !config.readOnly });

if (config.readOnly) {
  logger.info("server.read_only", {
    message: "Write tools are disabled. Set FVI_READ_ONLY=false to re-enable uploads.",
  });
}

await applyFeatureFlags(tools);
await applyAccessGates(tools);

const transport = new StdioServerTransport();
await server.connect(transport);

acceptLegacyToolNames(transport, (legacyName) => {
  logger.warn("tool.legacy_name", { name: legacyName, canonical: canonicalToolName(legacyName) });
});
