import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { collectionPath, resolveWhoami } from "./collection-resolve.js";
import { fviDelete, fviGet, fviPatch, fviPost, fviPut, uploadBody } from "./http-client.js";
import { logger } from "./logger.js";
import { classifyFviToken } from "./token-shape.js";
import {
  assertDecodedChecksum,
  readOptInUploadFile,
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

async function preparedUploadBody(input: {
  contentType: string;
  textContent?: string;
  contentBase64?: string;
  filePath?: string;
  checksumSha256?: string;
}) {
  if (input.filePath && (input.textContent || input.contentBase64)) {
    throw new Error("Provide filePath or inline content, not both.");
  }
  const body = input.filePath ? await readOptInUploadFile(input.filePath) : contentBuffer(input);
  const checksumSha256 = assertDecodedChecksum(body, input.checksumSha256);
  return { body, checksumSha256 };
}

const BATCH_DOWNLOAD_LIMIT = 50;

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

const tokenProblem = classifyFviToken(config.token, config.skipTokenCheck);
if (tokenProblem) {
  logger.error("token.rejected", { code: tokenProblem.code, message: tokenProblem.message });
  process.exit(1);
}

const server = new McpServer({
  name: "freevectoricons",
  version: "0.3.0-beta.1",
});

type RegisteredTool = ReturnType<typeof server.registerTool>;
type ToolScope = "read" | "write:assets" | "write:collection" | "write:records" | "delete";

const trackedTools: Array<{
  name: string;
  scope: ToolScope;
  capability?: string;
  tool: RegisteredTool;
}> = [];

function registerTrackedTool<InputArgs extends z.ZodRawShape>(
  meta: { scope: ToolScope; capability?: string },
  name: string,
  configArgs: {
    title: string;
    description: string;
    inputSchema?: InputArgs;
  },
  handler: (args: z.infer<z.ZodObject<InputArgs>>) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
) {
  const tool = server.registerTool(name, configArgs as never, handler as never);
  trackedTools.push({ name, scope: meta.scope, capability: meta.capability, tool });
  return tool;
}

/** Gated by the mcp.records_tools flag. */
const recordsTools: RegisteredTool[] = [];
/** Gated by mcp.records_tools and collections.records. */
const recordsDataTools: RegisteredTool[] = [];

const FEATURE_FLAG_FETCH_TIMEOUT_MS = 3_000;

/**
 * Hides records tools the API would refuse anyway. Fails open: if the flag
 * endpoint is unreachable every tool stays listed and the API remains the gate.
 */
async function applyFeatureFlags(): Promise<void> {
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
    if (!recordsToolsOn) recordsTools.forEach((tool) => tool.disable());
    if (!recordsDataOn) recordsDataTools.forEach((tool) => tool.disable());
    logger.info("feature_flags.applied", { recordsTools: recordsToolsOn, recordsData: recordsDataOn });
  } catch (error) {
    logger.warn("feature_flags.unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

logger.info("server.start", {
  readOnly: config.readOnly,
  timeoutMs: config.timeoutMs,
  uploadTimeoutMs: config.uploadTimeoutMs,
  retryMax: config.retryMax,
  hasCollectionIdEnv: Boolean(config.collectionId),
});


registerTrackedTool({ scope: "read" },
  "get_design_collection_context",
  {
    title: "Get Design Collection Context",
    description: "Return metadata-first context for the configured FreeVectorIcons design collection. Adapts instructions for brand vs records (collectionPurpose) and exposes transcription status on documents.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(await collectionPath("/context"), "get_design_collection_context") as JsonValue),
);

registerTrackedTool({ scope: "read" },
  "list_design_collection_assets",
  {
    title: "List Design Collection Assets",
    description: "List metadata for assets in the configured design collection.",
    inputSchema: {},
  },
  async () => asTextContent(await fviGet(await collectionPath("/assets"), "list_design_collection_assets") as JsonValue),
);

registerTrackedTool({ scope: "read" },
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

registerTrackedTool({ scope: "read" },
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

registerTrackedTool({ scope: "read" },
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

registerTrackedTool({ scope: "read" },
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


const spreadsheetPreviewTool = registerTrackedTool({ scope: "read" },
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
  registerTrackedTool({ scope: "write:assets" },
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

  registerTrackedTool({ scope: "write:assets" },
    "park_design_asset",
    {
      title: "Park Design Asset",
      description: "Upload inline text or base64 content directly into the configured FVI collection for DRL handoff.",
      inputSchema: {
        name: z.string().min(1).describe("File name for the asset."),
        contentType: z.enum(uploadContentTypes).describe("MIME type for the uploaded asset."),
        textContent: z.string().optional().describe("UTF-8 text content for SVG, Markdown, or other text assets."),
        contentBase64: z.string().optional().describe("Base64-encoded binary content for image/PDF assets."),
        checksumSha256: z.string().optional().describe("SHA-256 hex of the decoded bytes. Verified before upload."),
        filePath: z.string().optional().describe("Local file path. Off unless FVI_ALLOW_FILE_PATHS=true."),
        makeCanonicalDesignMd: z.boolean().optional().describe("Pin this Markdown file as the canonical DESIGN.md."),
        dryRun: z.boolean().optional().describe("Validate only. Writes nothing."),
        drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
        drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. logo, brief, source_art, mockup."),
        documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
        tags: z.array(z.string()).optional().describe("Optional searchable tags."),
        metadata: z.record(z.any()).optional().describe("Additional JSON metadata to store on the asset."),
      },
    },
    async (input) => {
      const prepared = await preparedUploadBody(input);
      const uploadResponse = await fviPost<{
        dryRun?: boolean;
        asset?: JsonRecord;
        collectionItemId?: string;
        versionId?: string;
        upload?: { url: string; method: string; headers?: Record<string, string> };
      }>(await collectionPath("/assets/uploads"), {
        name: input.name,
        contentType: input.contentType,
        sizeBytes: prepared.body.byteLength,
        checksumSha256: prepared.checksumSha256,
        ...(input.makeCanonicalDesignMd ? { makeCanonicalDesignMd: true } : {}),
        ...(input.dryRun ? { dryRun: true } : {}),
        metadata: withDrlMetadata({
          metadata: input.metadata as JsonRecord | undefined,
          drlProjectId: input.drlProjectId,
          drlAssetType: input.drlAssetType,
          documentType: input.documentType,
          tags: input.tags,
        }),
      }, "park_design_asset");
      if (uploadResponse.dryRun || !uploadResponse.upload) return asTextContent(uploadResponse as JsonValue);
      await uploadBody(uploadResponse.upload, prepared.body, "park_design_asset");
      const completed = uploadResponse.versionId
        ? await fviPost<JsonValue>(await collectionPath(`/uploads/${encodeURIComponent(uploadResponse.versionId)}/complete`), {}, "complete_design_asset_upload")
        : null;
      return asTextContent({
        asset: uploadResponse.asset ?? null,
        collectionItemId: uploadResponse.collectionItemId ?? null,
        uploaded: true,
        ...(completed ? { completed } : {}),
      });
    },
  );

  registerTrackedTool({ scope: "write:assets" },
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
        checksumSha256: z.string().optional().describe("SHA-256 hex of the decoded bytes. Verified before upload."),
        filePath: z.string().optional().describe("Local file path. Off unless FVI_ALLOW_FILE_PATHS=true."),
        makeCanonicalDesignMd: z.boolean().optional().describe("Pin this Markdown file as the canonical DESIGN.md."),
        dryRun: z.boolean().optional().describe("Validate only. Writes nothing."),
        drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
        drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. revision, source_art, approved_art."),
        documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
        tags: z.array(z.string()).optional().describe("Optional searchable tags."),
        metadata: z.record(z.any()).optional().describe("Additional JSON metadata to store on the version."),
      },
    },
    async (input) => {
      const validatedAssetId = validateAssetId(input.assetId);
      const prepared = await preparedUploadBody(input);
      const versionResponse = await fviPost<{
        dryRun?: boolean;
        asset?: JsonRecord;
        version?: JsonRecord;
        versionId?: string;
        upload?: { url: string; method: string; headers?: Record<string, string> };
      }>(await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/versions`), {
        ...(input.name ? { name: input.name } : {}),
        contentType: input.contentType,
        sizeBytes: prepared.body.byteLength,
        checksumSha256: prepared.checksumSha256,
        ...(input.makeCanonicalDesignMd ? { makeCanonicalDesignMd: true } : {}),
        ...(input.dryRun ? { dryRun: true } : {}),
        metadata: withDrlMetadata({
          metadata: input.metadata as JsonRecord | undefined,
          drlProjectId: input.drlProjectId,
          drlAssetType: input.drlAssetType,
          documentType: input.documentType,
          tags: input.tags,
        }),
      }, "create_design_asset_version");
      if (versionResponse.dryRun || !versionResponse.upload) return asTextContent(versionResponse as JsonValue);
      await uploadBody(versionResponse.upload, prepared.body, "create_design_asset_version");
      const completed = versionResponse.versionId
        ? await fviPost<JsonValue>(await collectionPath(`/uploads/${encodeURIComponent(versionResponse.versionId)}/complete`), {}, "complete_design_asset_upload")
        : null;
      return asTextContent({
        asset: versionResponse.asset ?? null,
        version: versionResponse.version ?? null,
        uploaded: true,
        ...(completed ? { completed } : {}),
      });
    },
  );

  recordsTools.push(registerTrackedTool({ scope: "write:collection" },
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
  ));

  recordsTools.push(registerTrackedTool({ scope: "write:collection" },
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
  ));

  recordsDataTools.push(registerTrackedTool({ scope: "write:records" },
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
  ));

  registerTrackedTool({ scope: "write:assets" },
    "update_design_asset",
    {
      title: "Update Design Asset",
      description:
        "Metadata-only PATCH for an uploaded collection asset: name, tags, documentType, drlProjectId, drlAssetType. Does not replace file bytes — use create_design_asset_version for content changes.",
      inputSchema: {
        assetId: z.string().min(1).describe("Asset id or collection item id."),
        name: z.string().min(1).optional().describe("New display file name. The extension cannot change."),
        metadata: z.object({
          set: z.record(z.string()).optional().describe("Custom metadata keys to set."),
          remove: z.array(z.string()).optional().describe("Custom metadata keys to remove."),
        }).optional(),
        links: z.array(z.object({
          rel: z.enum(["source", "summary", "replaces", "transcription", "related"]),
          assetId: z.string().nullable(),
        })).optional().describe("Links to other assets in this collection. Null assetId clears a link."),
        dryRun: z.boolean().optional(),
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
    async ({ assetId, name, tags, documentType, drlProjectId, drlAssetType, metadata, links, dryRun }) => {
      const validatedAssetId = validateAssetId(assetId);
      const response = await fviPatch<JsonValue>(
        await collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`),
        {
          ...(name !== undefined ? { name } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(documentType !== undefined ? { documentType } : {}),
          ...(drlProjectId !== undefined ? { drlProjectId } : {}),
          ...(drlAssetType !== undefined ? { drlAssetType } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          ...(links !== undefined ? { links } : {}),
          ...(dryRun ? { dryRun: true } : {}),
        },
        "update_design_asset",
      );
      return asTextContent(response);
    },
  );

  recordsTools.push(registerTrackedTool({ scope: "delete" },
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
  ));

  recordsTools.push(registerTrackedTool({ scope: "write:records" },
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
  ));

  registerTrackedTool({ scope: "write:collection", capability: "designMd" },
    "set_collection_design_md",
    {
      title: "Set Collection DESIGN.md",
      description: "Pin the collection's canonical DESIGN.md from inline Markdown or an existing Markdown asset. Lint does not block the save.",
      inputSchema: {
        content: z.string().optional().describe("Inline Markdown. Provide this or assetId."),
        assetId: z.string().optional().describe("Existing Markdown asset to pin."),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ content, assetId, dryRun }) => asTextContent(await fviPost(await collectionPath("/design-md"), {
      ...(content !== undefined ? { content } : {}),
      ...(assetId !== undefined ? { assetId } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    }, "set_collection_design_md") as JsonValue),
  );

  registerTrackedTool({ scope: "write:collection", capability: "purpose" },
    "update_design_collection_purpose",
    {
      title: "Update Design Collection Purpose",
      description: "Set collection purpose to brand or records.",
      inputSchema: {
        purpose: z.enum(["brand", "records"]),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ purpose, dryRun }) => asTextContent(await fviPut(await collectionPath("/purpose"), {
      purpose,
      ...(dryRun ? { dryRun: true } : {}),
    }, "update_design_collection_purpose") as JsonValue),
  );

  registerTrackedTool({ scope: "write:assets", capability: "versionUpload" },
    "create_design_asset_version_upload",
    {
      title: "Create Design Asset Version Upload",
      description: "Start a new version of an existing asset with a signed upload. Call complete_design_asset_upload after the bytes are uploaded. The version stays hidden until then.",
      inputSchema: {
        assetId: z.string().min(1),
        name: z.string().optional(),
        contentType: z.enum(uploadContentTypes),
        sizeBytes: z.number().int().positive(),
        checksumSha256: z.string().optional().describe("SHA-256 hex of the file bytes."),
        filePath: z.string().optional().describe("Local file to upload. Off unless FVI_ALLOW_FILE_PATHS=true."),
        dryRun: z.boolean().optional(),
      },
    },
    async (input) => {
      const assetId = validateAssetId(input.assetId);
      if (input.filePath) {
        const bytes = await readOptInUploadFile(input.filePath);
        const checksumSha256 = assertDecodedChecksum(bytes, input.checksumSha256);
        const started = await fviPost<{
          uploadId: string;
          upload: { url: string; method: string; headers?: Record<string, string> };
        }>(await collectionPath(`/assets/${encodeURIComponent(assetId)}/version-uploads`), {
          ...(input.name ? { name: input.name } : {}),
          contentType: input.contentType,
          sizeBytes: bytes.byteLength,
          checksumSha256,
          ...(input.dryRun ? { dryRun: true } : {}),
        }, "create_design_asset_version_upload");
        if (input.dryRun || !started.upload) return asTextContent(started as JsonValue);
        await uploadBody(started.upload, bytes, "create_design_asset_version_upload");
        const completed = await fviPost(
          await collectionPath(`/uploads/${encodeURIComponent(started.uploadId)}/complete`),
          {},
          "complete_design_asset_upload",
        );
        return asTextContent({ uploadId: started.uploadId, completed } as JsonValue);
      }
      validateUploadSize(input.sizeBytes);
      return asTextContent(await fviPost(await collectionPath(`/assets/${encodeURIComponent(assetId)}/version-uploads`), {
        ...(input.name ? { name: input.name } : {}),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
        ...(input.dryRun ? { dryRun: true } : {}),
      }, "create_design_asset_version_upload") as JsonValue);
    },
  );

  registerTrackedTool({ scope: "write:assets", capability: "versionUpload" },
    "complete_design_asset_upload",
    {
      title: "Complete Design Asset Upload",
      description: "Verify size and checksum, then make a pending version current.",
      inputSchema: {
        uploadId: z.string().min(1),
      },
    },
    async ({ uploadId }) => asTextContent(await fviPost(
      await collectionPath(`/uploads/${encodeURIComponent(uploadId)}/complete`),
      {},
      "complete_design_asset_upload",
    ) as JsonValue),
  );

  registerTrackedTool({ scope: "write:assets", capability: "versionHistory" },
    "revert_design_asset_to_version",
    {
      title: "Revert Design Asset To Version",
      description: "Make an earlier version current by copying it into a new version. History is not deleted.",
      inputSchema: {
        assetId: z.string().min(1),
        version: z.number().int().positive(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ assetId, version, dryRun }) => asTextContent(await fviPost(
      await collectionPath(`/assets/${encodeURIComponent(validateAssetId(assetId))}/revert`),
      { version, ...(dryRun ? { dryRun: true } : {}) },
      "revert_design_asset_to_version",
    ) as JsonValue),
  );

} else {
  logger.info("server.read_only", {
    message: "Write tools are disabled. Set FVI_READ_ONLY=false to re-enable uploads.",
  });
}

registerTrackedTool({ scope: "read", capability: "batchDownloadUrls" },
  "get_design_asset_download_urls",
  {
    title: "Get Design Asset Download URLs",
    description: "Short-lived download URLs for many assets. Lists over 50 ids are split automatically. One bad id does not fail the batch.",
    inputSchema: {
      assetIds: z.array(z.string().min(1)).min(1).describe("Asset ids or collection item ids."),
    },
  },
  async ({ assetIds }) => {
    const downloads: Record<string, JsonValue> = {};
    for (let index = 0; index < assetIds.length; index += BATCH_DOWNLOAD_LIMIT) {
      const chunk = assetIds.slice(index, index + BATCH_DOWNLOAD_LIMIT).map((id) => validateAssetId(id));
      const response = await fviPost<{ downloads?: Record<string, JsonValue> }>(
        await collectionPath("/assets/download-urls"),
        { assetIds: chunk },
        "get_design_asset_download_urls",
      );
      Object.assign(downloads, response.downloads ?? {});
    }
    return asTextContent({ downloads });
  },
);

registerTrackedTool({ scope: "read", capability: "versionHistory" },
  "list_design_asset_versions",
  {
    title: "List Design Asset Versions",
    description: "Version history for an uploaded asset: number, name, size, verified hash, and source.",
    inputSchema: { assetId: z.string().min(1) },
  },
  async ({ assetId }) => asTextContent(await fviGet(
    await collectionPath(`/assets/${encodeURIComponent(validateAssetId(assetId))}/versions`),
    "list_design_asset_versions",
  ) as JsonValue),
);

async function applyAccessGates(): Promise<void> {
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
  const allow = new Set(config.toolAllowlist);
  for (const entry of trackedTools) {
    if (config.readOnly && entry.scope !== "read") entry.tool.disable();
    if (scopes && !scopes.includes(entry.scope)) entry.tool.disable();
    if (entry.capability && (!capabilities || capabilities[entry.capability] !== true)) entry.tool.disable();
    if (allow.size > 0 && !allow.has(entry.name)) entry.tool.disable();
  }
}

recordsDataTools.push(spreadsheetPreviewTool);
await applyFeatureFlags();
await applyAccessGates();

const transport = new StdioServerTransport();
await server.connect(transport);
