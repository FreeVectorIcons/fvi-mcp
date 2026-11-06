import { z } from "zod";
import {
  assertDecodedChecksum,
  validateAssetId,
  validateSearchQuery,
  validateUploadSize,
  validateWriteContent,
} from "../validation.js";
import { defineTool, type ToolDefinition, type ToolHost, type UploadTarget } from "./types.js";

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

const UPLOAD_URL_GUIDANCE =
  "PUT the original file bytes to upload.url from any HTTP client, sending only upload.headers. Request the URL just before uploading: it is valid for 15 minutes, and refresh_asset_upload issues a new one. Never recompress, downscale or re-export design files to fit a size limit; if an upload fails, tell the user.";

const BATCH_DOWNLOAD_LIMIT = 50;

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

function readLocalFile(host: ToolHost, filePath: string): Promise<Buffer> {
  if (!host.readLocalFile) {
    throw new Error("filePath uploads are not available on this server. Send inline content or use a signed upload.");
  }
  return host.readLocalFile(filePath);
}

function contentBuffer(
  host: ToolHost,
  input: { contentType: string; textContent?: string; contentBase64?: string },
) {
  validateWriteContent(input, host.limits);
  if (typeof input.textContent === "string") return Buffer.from(input.textContent, "utf8");
  return Buffer.from(input.contentBase64!, "base64");
}

async function preparedUploadBody(
  host: ToolHost,
  input: {
    contentType: string;
    textContent?: string;
    contentBase64?: string;
    filePath?: string;
    checksumSha256?: string;
  },
) {
  if (input.filePath && (input.textContent || input.contentBase64)) {
    throw new Error("Provide filePath or inline content, not both.");
  }
  const body = input.filePath ? await readLocalFile(host, input.filePath) : contentBuffer(host, input);
  const checksumSha256 = assertDecodedChecksum(body, input.checksumSha256);
  return { body, checksumSha256 };
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

/** Every MCP tool, in listing order. Shared by the local stdio package and the hosted endpoint. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  defineTool({
    name: "get_collection_context",
    scope: "read",
    title: "Get Design Collection Context",
    description: "Return metadata-first context for the configured FreeVectorIcons design collection. Adapts instructions for brand vs records (collectionPurpose) and exposes transcription status on documents.",
    inputSchema: {},
    handler: async ({ api }) => asTextContent(await api.get(await api.collectionPath("/context"), "get_collection_context") as JsonValue),
  }),

  defineTool({
    name: "list_collection_assets",
    scope: "read",
    title: "List Design Collection Assets",
    description: "List metadata for assets in the configured design collection.",
    inputSchema: {},
    handler: async ({ api }) => asTextContent(await api.get(await api.collectionPath("/assets"), "list_collection_assets") as JsonValue),
  }),

  defineTool({
    name: "search_collection_assets",
    scope: "read",
    title: "Search Design Collection Assets",
    description: "Search design collection asset metadata by name, type, category, style, or tag.",
    inputSchema: {
      query: z.string().min(1).describe("Search query for asset metadata."),
    },
    handler: async ({ api, limits }, { query }) => {
      const validatedQuery = validateSearchQuery(query, limits);
      const params = new URLSearchParams({ query: validatedQuery });
      return asTextContent(
        await api.get(`${await api.collectionPath("/assets")}?${params.toString()}`, "search_collection_assets") as JsonValue,
      );
    },
  }),

  defineTool({
    name: "get_asset",
    scope: "read",
    title: "Get Design Asset",
    description: "Get metadata for one asset by asset id or collection item id.",
    inputSchema: {
      assetId: z.string().min(1).describe("Asset id or collection item id."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      return asTextContent(
        await api.get(await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`), "get_asset") as JsonValue,
      );
    },
  }),

  defineTool({
    name: "get_asset_download_url",
    scope: "read",
    title: "Get Design Asset Download URL",
    description: "Get a short-lived download URL for an uploaded design asset.",
    inputSchema: {
      assetId: z.string().min(1).describe("Uploaded asset id or collection item id."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      return asTextContent(
        await api.get(
          await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/download-url`),
          "get_asset_download_url",
        ) as JsonValue,
      );
    },
  }),

  defineTool({
    name: "get_asset_content",
    scope: "read",
    title: "Get Design Asset Content",
    description: "Get inline text content for safe design assets such as catalog SVGs, uploaded SVGs, and Markdown files.",
    inputSchema: {
      assetId: z.string().min(1).describe("Asset id or collection item id."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      return asTextContent(
        await api.get(
          await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/content`),
          "get_asset_content",
        ) as JsonValue,
      );
    },
  }),

  defineTool({
    name: "list_community_packs",
    scope: "read",
    title: "List Community Packs",
    description: "List the public community icon packs with license, icon count, and the agentGuide pointer (AGENTS.md and manifest.json URLs) for each pack.",
    inputSchema: {},
    handler: async ({ api }) => asTextContent(await api.get("/packs/catalog", "list_community_packs") as JsonValue),
  }),

  defineTool({
    name: "get_community_pack_guide",
    scope: "read",
    title: "Get Community Pack Guide",
    description: "Return the AGENTS.md for one community pack: generated facts (license, attribution, icon counts, URL patterns) plus the curator's usage guide. Read it before using the pack's icons.",
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9-]+$/).describe("Pack slug, e.g. empowering-fitness."),
    },
    handler: async ({ api }, { slug }) => asTextContent(
      await api.get(`/packs/${encodeURIComponent(slug)}/agent-guide`, "get_community_pack_guide") as JsonValue,
    ),
  }),

  defineTool({
    name: "get_asset_spreadsheet_preview",
    scope: "read",
    group: "recordsData",
    title: "Get Design Asset Spreadsheet Preview",
    description:
      "Return a size-capped first-sheet CSV or HTML preview for an .xls/.xlsx asset. Never dumps the full workbook — download URL remains primary for complete files.",
    inputSchema: {
      assetId: z.string().min(1).describe("Spreadsheet asset id or collection item id."),
      format: z.enum(["csv", "html"]).optional().describe("Preview format. Defaults to csv."),
    },
    handler: async ({ api, limits }, { assetId, format }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const query = format ? `?format=${encodeURIComponent(format)}` : "";
      return asTextContent(
        await api.get(
          await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/spreadsheet-preview${query}`),
          "get_asset_spreadsheet_preview",
        ) as JsonValue,
      );
    },
  }),

  defineTool({
    name: "create_asset_upload",
    scope: "write:assets",
    title: "Create Design Asset Upload",
    description: `Create a collection asset record and an upload URL, for files too large to send inline. ${UPLOAD_URL_GUIDANCE} Then call complete_asset_upload with the returned versionId as uploadId.`,
    inputSchema: {
      name: z.string().min(1).describe("File name for the asset."),
      contentType: z.enum(uploadContentTypes).describe("MIME type for the uploaded asset."),
      sizeBytes: z.number().int().positive().describe("Exact byte size that will be uploaded."),
      checksumSha256: z.string().optional().describe("Optional SHA-256 checksum for provenance."),
      drlProjectId: z.string().optional().describe("Optional DRL project identifier to store in metadata."),
      drlAssetType: z.string().optional().describe("Optional DRL asset role, e.g. logo, brief, source_art, mockup."),
      documentType: z.string().optional().describe("Optional document type for Markdown/PDF supporting documents."),
      tags: z.array(z.string()).optional().describe("Optional searchable tags."),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional JSON metadata to store on the asset."),
    },
    handler: async ({ api, limits }, { name, contentType, sizeBytes, checksumSha256, drlProjectId, drlAssetType, documentType, tags, metadata }) => {
      validateUploadSize(sizeBytes, limits);
      const response = await api.post<JsonValue>(await api.collectionPath("/assets/uploads"), {
        name,
        contentType,
        sizeBytes,
        ...(checksumSha256 ? { checksumSha256 } : {}),
        metadata: withDrlMetadata({ metadata: metadata as JsonRecord | undefined, drlProjectId, drlAssetType, documentType, tags }),
      }, "create_asset_upload");
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "park_asset",
    scope: "write:assets",
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
      metadata: z.record(z.string(), z.any()).optional().describe("Additional JSON metadata to store on the asset."),
    },
    localOnlyInputs: ["filePath"],
    handler: async (host, input) => {
      const { api } = host;
      const prepared = await preparedUploadBody(host, input);
      const uploadResponse = await api.post<{
        dryRun?: boolean;
        asset?: JsonRecord;
        collectionItemId?: string;
        versionId?: string;
        upload?: UploadTarget;
      }>(await api.collectionPath("/assets/uploads"), {
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
      }, "park_asset");
      if (uploadResponse.dryRun || !uploadResponse.upload) return asTextContent(uploadResponse as JsonValue);
      await api.upload(uploadResponse.upload, prepared.body, "park_asset");
      const completed = uploadResponse.versionId
        ? await api.post<JsonValue>(await api.collectionPath(`/uploads/${encodeURIComponent(uploadResponse.versionId)}/complete`), {}, "complete_asset_upload")
        : null;
      return asTextContent({
        asset: uploadResponse.asset ?? null,
        collectionItemId: uploadResponse.collectionItemId ?? null,
        uploaded: true,
        ...(completed ? { completed } : {}),
      });
    },
  }),

  defineTool({
    name: "create_asset_version",
    scope: "write:assets",
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
      metadata: z.record(z.string(), z.any()).optional().describe("Additional JSON metadata to store on the version."),
    },
    localOnlyInputs: ["filePath"],
    handler: async (host, input) => {
      const { api, limits } = host;
      const validatedAssetId = validateAssetId(input.assetId, limits);
      const prepared = await preparedUploadBody(host, input);
      const versionResponse = await api.post<{
        dryRun?: boolean;
        asset?: JsonRecord;
        version?: JsonRecord;
        versionId?: string;
        upload?: UploadTarget;
      }>(await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/versions`), {
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
      }, "create_asset_version");
      if (versionResponse.dryRun || !versionResponse.upload) return asTextContent(versionResponse as JsonValue);
      await api.upload(versionResponse.upload, prepared.body, "create_asset_version");
      const completed = versionResponse.versionId
        ? await api.post<JsonValue>(await api.collectionPath(`/uploads/${encodeURIComponent(versionResponse.versionId)}/complete`), {}, "complete_asset_upload")
        : null;
      return asTextContent({
        asset: versionResponse.asset ?? null,
        version: versionResponse.version ?? null,
        uploaded: true,
        ...(completed ? { completed } : {}),
      });
    },
  }),

  defineTool({
    name: "set_collection_strategy_brief",
    scope: "write:collection",
    group: "records",
    title: "Update Design Collection Strategy Brief",
    description:
      "Replace collection.metadata.strategyBrief (the native Design Brief → Strategy Brief tab / MCP strategy.brief). Parked STRATEGY_BRIEF.md does NOT fill the native tab unless promoted. Mutates collection metadata and appends a revision.",
    inputSchema: {
      content: z.string().min(1).describe("Markdown strategy brief content to store as the canonical brief."),
      mode: z.enum(["replace"]).optional().describe('Write mode. Only "replace" is supported in P0.'),
    },
    handler: async ({ api }, { content, mode }) => {
      const response = await api.put<JsonValue>(
        await api.collectionPath("/strategy-brief"),
        {
          content,
          ...(mode ? { mode } : {}),
        },
        "set_collection_strategy_brief",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "promote_asset_to_strategy_brief",
    scope: "write:collection",
    group: "records",
    title: "Promote Design Asset To Strategy Brief",
    description:
      "Copy an inline Markdown asset into collection.metadata.strategyBrief. Parked STRATEGY_BRIEF.md does NOT fill the native Strategy Brief tab unless promoted with this tool. Does not delete the source asset.",
    inputSchema: {
      assetId: z.string().min(1).describe("Markdown asset id or collection item id to promote."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const response = await api.post<JsonValue>(
        await api.collectionPath("/strategy-brief/promote"),
        { assetId: validatedAssetId },
        "promote_asset_to_strategy_brief",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "set_asset_transcription_status",
    scope: "write:records",
    group: "recordsData",
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
    handler: async ({ api, limits }, { assetId, textLayer, transcription }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const response = await api.patch<JsonValue>(
        await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/transcription-status`),
        {
          ...(textLayer ? { textLayer } : {}),
          ...(transcription ? { transcription } : {}),
        },
        "set_asset_transcription_status",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "update_asset",
    scope: "write:assets",
    title: "Update Design Asset",
    description:
      "Metadata-only PATCH for an uploaded collection asset: name, tags, documentType, drlProjectId, drlAssetType. Does not replace file bytes — use create_asset_version for content changes.",
    inputSchema: {
      assetId: z.string().min(1).describe("Asset id or collection item id."),
      name: z.string().min(1).optional().describe("New display file name. The extension cannot change."),
      metadata: z.object({
        set: z.record(z.string(), z.string()).optional().describe("Custom metadata keys to set."),
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
    handler: async ({ api, limits }, { assetId, name, tags, documentType, drlProjectId, drlAssetType, metadata, links, dryRun }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const response = await api.patch<JsonValue>(
        await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}`),
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
        "update_asset",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "delete_collection_asset",
    scope: "delete",
    group: "records",
    title: "Delete Design Collection Asset (Soft Unlink)",
    description:
      "Soft-unlink a collection item only (same as session DELETE …/items/:itemId). Removes the item from the collection and clears assets.collection_id — does NOT hard-delete storage bytes. Prefer this over discard when decluttering a collection.",
    inputSchema: {
      assetId: z
        .string()
        .min(1)
        .describe("Collection item id or uploaded asset id to unlink from the collection."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const response = await api.delete<JsonValue>(
        await api.collectionPath(`/items/${encodeURIComponent(validatedAssetId)}`),
        "delete_collection_asset",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "probe_asset_text_layer",
    scope: "write:records",
    group: "records",
    title: "Probe Design Asset Text Layer",
    description:
      "Best-effort PDF embedded text-layer probe. Updates textLayer / transcription metadata when FVI_PDF_TEXT_LAYER_PROBE is enabled on the API. Handwritten/scanned quality is NOT guaranteed; failures set transcription.status=failed without deleting the asset. No paid OCR API key required.",
    inputSchema: {
      assetId: z.string().min(1).describe("PDF asset id or collection item id."),
    },
    handler: async ({ api, limits }, { assetId }) => {
      const validatedAssetId = validateAssetId(assetId, limits);
      const response = await api.post<JsonValue>(
        await api.collectionPath(`/assets/${encodeURIComponent(validatedAssetId)}/text-layer-probe`),
        {},
        "probe_asset_text_layer",
      );
      return asTextContent(response);
    },
  }),

  defineTool({
    name: "set_collection_design_md",
    scope: "write:collection",
    capability: "designMd",
    title: "Set Collection DESIGN.md",
    description: "Pin the collection's canonical DESIGN.md from inline Markdown or an existing Markdown asset. Lint does not block the save.",
    inputSchema: {
      content: z.string().optional().describe("Inline Markdown. Provide this or assetId."),
      assetId: z.string().optional().describe("Existing Markdown asset to pin."),
      dryRun: z.boolean().optional(),
    },
    handler: async ({ api }, { content, assetId, dryRun }) => asTextContent(await api.post(await api.collectionPath("/design-md"), {
      ...(content !== undefined ? { content } : {}),
      ...(assetId !== undefined ? { assetId } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    }, "set_collection_design_md") as JsonValue),
  }),

  defineTool({
    name: "update_collection_purpose",
    scope: "write:collection",
    capability: "purpose",
    title: "Update Design Collection Purpose",
    description: "Set collection purpose to brand or records.",
    inputSchema: {
      purpose: z.enum(["brand", "records"]),
      dryRun: z.boolean().optional(),
    },
    handler: async ({ api }, { purpose, dryRun }) => asTextContent(await api.put(await api.collectionPath("/purpose"), {
      purpose,
      ...(dryRun ? { dryRun: true } : {}),
    }, "update_collection_purpose") as JsonValue),
  }),

  defineTool({
    name: "create_asset_version_upload",
    scope: "write:assets",
    capability: "versionUpload",
    title: "Create Design Asset Version Upload",
    description: `Start a new version of an existing asset with an upload URL. ${UPLOAD_URL_GUIDANCE} Then call complete_asset_upload with the returned uploadId. The version stays hidden until then.`,
    inputSchema: {
      assetId: z.string().min(1),
      name: z.string().optional(),
      contentType: z.enum(uploadContentTypes),
      sizeBytes: z.number().int().positive(),
      checksumSha256: z.string().optional().describe("SHA-256 hex of the file bytes."),
      filePath: z.string().optional().describe("Local file to upload. Off unless FVI_ALLOW_FILE_PATHS=true."),
      dryRun: z.boolean().optional(),
    },
    localOnlyInputs: ["filePath"],
    handler: async (host, input) => {
      const { api, limits } = host;
      const assetId = validateAssetId(input.assetId, limits);
      if (input.filePath) {
        const bytes = await readLocalFile(host, input.filePath);
        const checksumSha256 = assertDecodedChecksum(bytes, input.checksumSha256);
        const started = await api.post<{
          uploadId: string;
          upload: UploadTarget;
        }>(await api.collectionPath(`/assets/${encodeURIComponent(assetId)}/version-uploads`), {
          ...(input.name ? { name: input.name } : {}),
          contentType: input.contentType,
          sizeBytes: bytes.byteLength,
          checksumSha256,
          ...(input.dryRun ? { dryRun: true } : {}),
        }, "create_asset_version_upload");
        if (input.dryRun || !started.upload) return asTextContent(started as JsonValue);
        await api.upload(started.upload, bytes, "create_asset_version_upload");
        const completed = await api.post(
          await api.collectionPath(`/uploads/${encodeURIComponent(started.uploadId)}/complete`),
          {},
          "complete_asset_upload",
        );
        return asTextContent({ uploadId: started.uploadId, completed } as JsonValue);
      }
      validateUploadSize(input.sizeBytes, limits);
      return asTextContent(await api.post(await api.collectionPath(`/assets/${encodeURIComponent(assetId)}/version-uploads`), {
        ...(input.name ? { name: input.name } : {}),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
        ...(input.dryRun ? { dryRun: true } : {}),
      }, "create_asset_version_upload") as JsonValue);
    },
  }),

  defineTool({
    name: "complete_asset_upload",
    scope: "write:assets",
    capability: "versionUpload",
    title: "Complete Design Asset Upload",
    description: "Verify size and checksum, then make a pending version current.",
    inputSchema: {
      uploadId: z.string().min(1),
    },
    handler: async ({ api }, { uploadId }) => asTextContent(await api.post(
      await api.collectionPath(`/uploads/${encodeURIComponent(uploadId)}/complete`),
      {},
      "complete_asset_upload",
    ) as JsonValue),
  }),

  defineTool({
    name: "refresh_asset_upload",
    scope: "write:assets",
    capability: "versionUpload",
    title: "Refresh Design Asset Upload",
    description: "Get a fresh upload URL for a pending upload whose URL expired. The previous URL stops working. Upload the original bytes; never substitute a smaller file.",
    inputSchema: {
      uploadId: z.string().min(1).describe("The uploadId (or versionId) returned when the upload was created."),
    },
    handler: async ({ api }, { uploadId }) => asTextContent(await api.post(
      await api.collectionPath(`/uploads/${encodeURIComponent(uploadId)}/refresh`),
      {},
      "refresh_asset_upload",
    ) as JsonValue),
  }),

  defineTool({
    name: "revert_asset_to_version",
    scope: "write:assets",
    capability: "versionHistory",
    title: "Revert Design Asset To Version",
    description: "Make an earlier version current by copying it into a new version. History is not deleted.",
    inputSchema: {
      assetId: z.string().min(1),
      version: z.number().int().positive(),
      dryRun: z.boolean().optional(),
    },
    handler: async ({ api, limits }, { assetId, version, dryRun }) => asTextContent(await api.post(
      await api.collectionPath(`/assets/${encodeURIComponent(validateAssetId(assetId, limits))}/revert`),
      { version, ...(dryRun ? { dryRun: true } : {}) },
      "revert_asset_to_version",
    ) as JsonValue),
  }),

  defineTool({
    name: "get_asset_download_urls",
    scope: "read",
    capability: "batchDownloadUrls",
    title: "Get Design Asset Download URLs",
    description: "Short-lived download URLs for many assets. Lists over 50 ids are split automatically. One bad id does not fail the batch.",
    inputSchema: {
      assetIds: z.array(z.string().min(1)).min(1).describe("Asset ids or collection item ids."),
    },
    handler: async ({ api, limits }, { assetIds }) => {
      const downloads: Record<string, JsonValue> = {};
      for (let index = 0; index < assetIds.length; index += BATCH_DOWNLOAD_LIMIT) {
        const chunk = assetIds.slice(index, index + BATCH_DOWNLOAD_LIMIT).map((id) => validateAssetId(id, limits));
        const response = await api.post<{ downloads?: Record<string, JsonValue> }>(
          await api.collectionPath("/assets/download-urls"),
          { assetIds: chunk },
          "get_asset_download_urls",
        );
        Object.assign(downloads, response.downloads ?? {});
      }
      return asTextContent({ downloads });
    },
  }),

  defineTool({
    name: "list_asset_versions",
    scope: "read",
    capability: "versionHistory",
    title: "List Design Asset Versions",
    description: "Version history for an uploaded asset: number, name, size, verified hash, and source.",
    inputSchema: { assetId: z.string().min(1) },
    handler: async ({ api, limits }, { assetId }) => asTextContent(await api.get(
      await api.collectionPath(`/assets/${encodeURIComponent(validateAssetId(assetId, limits))}/versions`),
      "list_asset_versions",
    ) as JsonValue),
  }),
];
