import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { collectionPath, resolveCollectionId } from "./collection-resolve.js";
import { fviDelete, fviGet, fviPatch, fviPost, fviPut, uploadBody } from "./http-client.js";
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
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

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
  version: "0.2.0-beta.6",
});

logger.info("server.start", {
  readOnly: config.readOnly,
  timeoutMs: config.timeoutMs,
  uploadTimeoutMs: config.uploadTimeoutMs,
  retryMax: config.retryMax,
  hasCollectionIdEnv: Boolean(config.collectionId),
});

// Resolve collection from token (whoami). Fail closed if optional FVI_COLLECTION_ID mismatches.
// Errors here are deferred to first tool use if whoami is unreachable at spawn.
void resolveCollectionId().catch((error) => {
  logger.warn("collection.resolve_deferred", {
    message: error instanceof Error ? error.message : String(error),
  });
});

server.registerTool(
  "get_design_collection_context",
  {
    title: "Get Design Collection Context",
    description: "Return metadata-first context for the configured FreeVectorIcons design collection. Adapts instructions for brand vs records (collectionPurpose) and exposes transcription status on documents.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(await collectionPath("/context"), "get_design_collection_context") as JsonValue),
);

server.registerTool(
  "list_design_collection_assets",
  {
    title: "List Design Collection Assets",
    description: "List metadata for assets in the configured design collection.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(await collectionPath("/assets"), "list_design_collection_assets") as JsonValue),
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
      await fviGet(`${await collectionPath("/assets")}?${params.toString()}`, "search_design_collection_assets") as JsonValue,
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
      await fviGet(await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`), "get_design_asset") as JsonValue,
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
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/download-url`),
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
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/content`),
        "get_design_asset_content",
      ) as JsonValue,
    );
  },
);


server.registerTool(
  "get_design_asset_spreadsheet_preview",
  {
    title: "Get Design Asset Spreadsheet Preview",
    description:
      "Return a size-capped first-sheet CSV or HTML preview for an .xls/.xlsx asset. Never dumps the full workbook — download URL remains primary for complete files.",
    inputSchema: {
      assetId: z.string().min(1).describe("Spreadsheet asset id or collection item id."),
      format: z.enum(["csv", "html"]).optional().describe("Preview format. Defaults to csv."),
    },
  },
  async ({ assetId, format }) => {
    const validatedAssetId = validateAssetId(assetId);
    const query = format ? `?format=${encodeURIComponent(format)}` : "";
    return asTextContent(
      await fviGet(
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/spreadsheet-preview${query}`),
        "get_design_asset_spreadsheet_preview",
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
      const response = await fviPost<JsonValue>(await collectionPath("/assets/uploads"), {
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
      }>(await collectionPath("/assets/uploads"), {
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
      }>(await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/versions`), {
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

  server.registerTool(
    "update_design_collection_strategy_brief",
    {
      title: "Update Design Collection Strategy Brief",
      description:
        "Replace collection.metadata.strategyBrief (the native Design Brief → Strategy Brief tab / MCP strategy.brief). Parked STRATEGY_BRIEF.md does NOT fill the native tab unless promoted. Mutates collection metadata and appends a revision.",
      inputSchema: {
        content: z.string().min(1).describe("Markdown strategy brief content to store as the canonical brief."),
        mode: z.enum(["replace"]).optional().describe('Write mode. Only "replace" is supported in P0.'),
      },
    },
    async ({ content, mode }) => {
      const response = await fviPut<JsonValue>(
        await collectionPath("/strategy-brief"),
        {
          content,
          ...(mode ? { mode } : {}),
        },
        "update_design_collection_strategy_brief",
      );
      return asTextContent(response);
    },
  );

  server.registerTool(
    "promote_design_asset_to_strategy_brief",
    {
      title: "Promote Design Asset To Strategy Brief",
      description:
        "Copy an inline Markdown asset into collection.metadata.strategyBrief. Parked STRATEGY_BRIEF.md does NOT fill the native Strategy Brief tab unless promoted with this tool. Does not delete the source asset.",
      inputSchema: {
        assetId: z.string().min(1).describe("Markdown asset id or collection item id to promote."),
      },
    },
    async ({ assetId }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviPost<JsonValue>(
        await collectionPath("/strategy-brief/promote"),
        { assetId: validatedAssetId },
        "promote_design_asset_to_strategy_brief",
      );
      return asTextContent(response);
    },
  );

  server.registerTool(
    "update_design_asset_transcription_status",
    {
      title: "Update Design Asset Transcription Status",
      description:
        "Update textLayer and/or transcription status metadata on a PDF (or other doc) asset. Park Markdown transcriptions as sibling assets and link via transcription.transcriptionAssetId. Does not run OCR.",
      inputSchema: {
        assetId: z.string().min(1).describe("Asset id or collection item id."),
        textLayer: z
          .enum(["none", "partial", "full", "unknown"])
          .optional()
          .describe("Detected text layer coverage on the source document."),
        transcription: z
          .object({
            status: z.enum(["none", "pending", "ready", "failed"]).optional(),
            confidence: z.number().min(0).max(1).optional(),
            languageHints: z.array(z.string()).optional(),
            source: z.enum(["agent", "ocr", "human"]).optional(),
            transcriptionAssetId: z
              .string()
              .nullable()
              .optional()
              .describe("Sibling Markdown asset id containing the transcription."),
          })
          .optional()
          .describe("Transcription status patch."),
      },
    },
    async ({ assetId, textLayer, transcription }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviPatch<JsonValue>(
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/transcription-status`),
        {
          ...(textLayer ? { textLayer } : {}),
          ...(transcription ? { transcription } : {}),
        },
        "update_design_asset_transcription_status",
      );
      return asTextContent(response);
    },
  );

  server.registerTool(
    "update_design_asset",
    {
      title: "Update Design Asset",
      description:
        "Metadata-only PATCH for an uploaded collection asset: name, tags, documentType, drlProjectId, drlAssetType. Does not replace file bytes — use create_design_asset_version for content changes.",
      inputSchema: {
        assetId: z.string().min(1).describe("Asset id or collection item id."),
        name: z.string().min(1).optional().describe("New display file name."),
        tags: z.array(z.string()).optional().describe("Replace searchable tags."),
        documentType: z
          .string()
          .nullable()
          .optional()
          .describe("Document role (brand or records vocabulary), or null to clear."),
        drlProjectId: z.string().nullable().optional().describe("Optional DRL project id, or null to clear."),
        drlAssetType: z.string().nullable().optional().describe("Optional DRL asset role, or null to clear."),
      },
    },
    async ({ assetId, name, tags, documentType, drlProjectId, drlAssetType }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviPatch<JsonValue>(
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`),
        {
          ...(name !== undefined ? { name } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(documentType !== undefined ? { documentType } : {}),
          ...(drlProjectId !== undefined ? { drlProjectId } : {}),
          ...(drlAssetType !== undefined ? { drlAssetType } : {}),
        },
        "update_design_asset",
      );
      return asTextContent(response);
    },
  );

  server.registerTool(
    "delete_design_collection_asset",
    {
      title: "Delete Design Collection Asset (Soft Unlink)",
      description:
        "Soft-unlink a collection item only (same as session DELETE …/items/:itemId). Removes the item from the collection and clears assets.collection_id — does NOT hard-delete storage bytes. Prefer this over discard when decluttering a collection.",
      inputSchema: {
        assetId: z
          .string()
          .min(1)
          .describe("Collection item id or uploaded asset id to unlink from the collection."),
      },
    },
    async ({ assetId }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviDelete<JsonValue>(
        await collectionPath(`/items/${encodeURIComponent(validatedAssetId)}`),
        "delete_design_collection_asset",
      );
      return asTextContent(response);
    },
  );

  server.registerTool(
    "probe_design_asset_text_layer",
    {
      title: "Probe Design Asset Text Layer",
      description:
        "Best-effort PDF embedded text-layer probe. Updates textLayer / transcription metadata when FVI_PDF_TEXT_LAYER_PROBE is enabled on the API. Handwritten/scanned quality is NOT guaranteed; failures set transcription.status=failed without deleting the asset. No paid OCR API key required.",
      inputSchema: {
        assetId: z.string().min(1).describe("PDF asset id or collection item id."),
      },
    },
    async ({ assetId }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviPost<JsonValue>(
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/text-layer-probe`),
        {},
        "probe_design_asset_text_layer",
      );
      return asTextContent(response);
    },
  );

} else {
  logger.info("server.read_only", {
    message: "Write tools are disabled. Set FVI_READ_ONLY=false to re-enable uploads.",
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
