import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { fviGet, fviPost, uploadBody } from "./http-client.js";
import { logger } from "./logger.js";
import {
  validateAssetId,
  validateSearchQuery,
  validateUploadSize,
  validateWriteContent,
} from "./validation.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

const uploadContentTypes = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
  "image/icns",
  "text/markdown",
  "application/pdf",
] as const;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asTextContent(payload: JsonValue) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function collectionPath(path: string): string {
  return `/mcp/collections/${encodeURIComponent(requireEnv(config.collectionId, "FVI_COLLECTION_ID"))}${path}`;
}

function contentBuffer(input: { contentType: string; textContent?: string; contentBase64?: string }) {
  validateWriteContent(input);
  if (typeof input.textContent === "string") return Buffer.from(input.textContent, "utf8");
  return Buffer.from(input.contentBase64!, "base64");
}

function withDrlMetadata(input: {
  metadata?: JsonRecord;
  drlProjectId?: string;
  drlAssetType?: string;
  documentType?: string;
  tags?: string[];
}) {
  return {
    ...(input.metadata ?? {}),
    ...(input.drlProjectId ? { drlProjectId: input.drlProjectId } : {}),
    ...(input.drlAssetType ? { drlAssetType: input.drlAssetType } : {}),
    ...(input.documentType ? { documentType: input.documentType } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  };
}

const server = new McpServer({
  name: "freevectoricons",
  version: "0.2.0-beta.0",
});

logger.info("server.start", {
  readOnly: config.readOnly,
  timeoutMs: config.timeoutMs,
  uploadTimeoutMs: config.uploadTimeoutMs,
  retryMax: config.retryMax,
});

server.registerTool(
  "get_design_collection_context",
  {
    title: "Get Design Collection Context",
    description: "Return metadata-first context for the configured FreeVectorIcons design collection.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(collectionPath("/context"), "get_design_collection_context") as JsonValue),
);

server.registerTool(
  "list_design_collection_assets",
  {
    title: "List Design Collection Assets",
    description: "List metadata for assets in the configured design collection.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(collectionPath("/assets"), "list_design_collection_assets") as JsonValue),
);

server.registerTool(
  "search_design_collection_assets",
  {
    title: "Search Design Collection Assets",
    description: "Search design collection asset metadata by name, type, category, style, or tag.",
    inputSchema: {
      query: z.string().min(1).describe("Search query for asset metadata."),
    },
  },
  async ({ query }) => {
    const validatedQuery = validateSearchQuery(query);
    const params = new URLSearchParams({ query: validatedQuery });
    return asTextContent(
      await fviGet(`${collectionPath("/assets")}?${params.toString()}`, "search_design_collection_assets") as JsonValue,
    );
  },
);

server.registerTool(
  "get_design_asset",
  {
    title: "Get Design Asset",
    description: "Get metadata for one asset by asset id or collection item id.",
    inputSchema: {
      assetId: z.string().min(1).describe("Asset id or collection item id."),
    },
  },
  async ({ assetId }) => {
    const validatedAssetId = validateAssetId(assetId);
    return asTextContent(
      await fviGet(collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`), "get_design_asset") as JsonValue,
    );
  },
);

server.registerTool(
  "get_design_asset_download_url",
  {
    title: "Get Design Asset Download URL",
    description: "Get a short-lived download URL for an uploaded design asset.",
    inputSchema: {
      assetId: z.string().min(1).describe("Uploaded asset id or collection item id."),
    },
  },
  async ({ assetId }) => {
    const validatedAssetId = validateAssetId(assetId);
    return asTextContent(
      await fviGet(
        collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/download-url`),
        "get_design_asset_download_url",
      ) as JsonValue,
    );
  },
);

server.registerTool(
  "get_design_asset_content",
  {
    title: "Get Design Asset Content",
    description: "Get inline text content for safe design assets such as catalog SVGs, uploaded SVGs, and Markdown files.",
    inputSchema: {
      assetId: z.string().min(1).describe("Asset id or collection item id."),
    },
  },
  async ({ assetId }) => {
    const validatedAssetId = validateAssetId(assetId);
    return asTextContent(
      await fviGet(
        collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/content`),
        "get_design_asset_content",
      ) as JsonValue,
    );
  },
);

if (!config.readOnly) {
  server.registerTool(
    "create_design_asset_upload",
    {
      title: "Create Design Asset Upload",
      description: "Create a signed upload target and collection asset record for parking a DRL/FVI design asset.",
      inputSchema: {
        name: z.string().min(1).describe("File name for the asset."),
        contentType: z.enum(uploadContentTypes).describe("MIME type for the uploaded asset."),
        sizeBytes: z.number().int().positive().describe("Exact byte size that will be uploaded."),
        checksumSha256: z.string().optional().describe("Optional SHA-256 checksum for provenance."),
        drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
        drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. logo, brief, source_art, mockup."),
        documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
        tags: z.array(z.string()).optional().describe("Optional searchable tags."),
        metadata: z.record(z.any()).optional().describe("Additional JSON metadata to store on the asset."),
      },
    },
    async ({ name, contentType, sizeBytes, checksumSha256, drlProjectId, drlAssetType, documentType, tags, metadata }) => {
      validateUploadSize(sizeBytes);
      const response = await fviPost<JsonValue>(collectionPath("/assets/uploads"), {
        name,
        contentType,
        sizeBytes,
        ...(checksumSha256 ? { checksumSha256 } : {}),
        metadata: withDrlMetadata({ metadata: metadata as JsonRecord | undefined, drlProjectId, drlAssetType, documentType, tags }),
      }, "create_design_asset_upload");
      return asTextContent(response);
    },
  );

  server.registerTool(
    "park_design_asset",
    {
      title: "Park Design Asset",
      description: "Upload inline text or base64 content directly into the configured FVI collection for DRL handoff.",
      inputSchema: {
        name: z.string().min(1).describe("File name for the asset."),
        contentType: z.enum(uploadContentTypes).describe("MIME type for the uploaded asset."),
        textContent: z.string().optional().describe("UTF-8 text content for SVG, Markdown, or other text assets."),
        contentBase64: z.string().optional().describe("Base64-encoded binary content for image/PDF assets."),
        checksumSha256: z.string().optional().describe("Optional SHA-256 checksum for provenance."),
        drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
        drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. logo, brief, source_art, mockup."),
        documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
        tags: z.array(z.string()).optional().describe("Optional searchable tags."),
        metadata: z.record(z.any()).optional().describe("Additional JSON metadata to store on the asset."),
      },
    },
    async (input) => {
      const body = contentBuffer(input);
      const uploadResponse = await fviPost<{
        asset: JsonRecord;
        collectionItemId: string;
        upload: { url: string; method: string; headers?: Record<string, string> };
      }>(collectionPath("/assets/uploads"), {
        name: input.name,
        contentType: input.contentType,
        sizeBytes: body.byteLength,
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
        metadata: withDrlMetadata({
          metadata: input.metadata as JsonRecord | undefined,
          drlProjectId: input.drlProjectId,
          drlAssetType: input.drlAssetType,
          documentType: input.documentType,
          tags: input.tags,
        }),
      }, "park_design_asset");
      await uploadBody(uploadResponse.upload, body, "park_design_asset");
      return asTextContent({
        asset: uploadResponse.asset,
        collectionItemId: uploadResponse.collectionItemId,
        uploaded: true,
      });
    },
  );

  server.registerTool(
    "create_design_asset_version",
    {
      title: "Create Design Asset Version",
      description: "Upload inline text or base64 content as a new version of an existing uploaded design asset.",
      inputSchema: {
        assetId: z.string().min(1).describe("Existing uploaded asset id."),
        name: z.string().optional().describe("Optional file name for the new current asset version."),
        contentType: z.enum(uploadContentTypes).describe("MIME type for the uploaded version."),
        textContent: z.string().optional().describe("UTF-8 text content for SVG, Markdown, or other text assets."),
        contentBase64: z.string().optional().describe("Base64-encoded binary content for image/PDF assets."),
        checksumSha256: z.string().optional().describe("Optional SHA-256 checksum for provenance."),
        drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
        drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. revision, source_art, approved_art."),
        documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
        tags: z.array(z.string()).optional().describe("Optional searchable tags."),
        metadata: z.record(z.any()).optional().describe("Additional JSON metadata to store on the version."),
      },
    },
    async (input) => {
      const validatedAssetId = validateAssetId(input.assetId);
      const body = contentBuffer(input);
      const versionResponse = await fviPost<{
        asset: JsonRecord;
        version: JsonRecord;
        upload: { url: string; method: string; headers?: Record<string, string> };
      }>(collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/versions`), {
        ...(input.name ? { name: input.name } : {}),
        contentType: input.contentType,
        sizeBytes: body.byteLength,
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
        metadata: withDrlMetadata({
          metadata: input.metadata as JsonRecord | undefined,
          drlProjectId: input.drlProjectId,
          drlAssetType: input.drlAssetType,
          documentType: input.documentType,
          tags: input.tags,
        }),
      }, "create_design_asset_version");
      await uploadBody(versionResponse.upload, body, "create_design_asset_version");
      return asTextContent({
        asset: versionResponse.asset,
        version: versionResponse.version,
        uploaded: true,
      });
    },
  );
} else {
  logger.info("server.read_only", {
    message: "Write tools are disabled. Set FVI_READ_ONLY=false to re-enable uploads.",
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
