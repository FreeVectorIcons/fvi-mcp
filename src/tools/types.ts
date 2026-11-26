import type { z } from "zod";
import type { ToolLimits } from "../limits.js";

export type ToolScope = "read" | "write:assets" | "write:collection" | "write:records" | "delete";

/** `records` is gated by mcp.records_tools; `recordsData` also needs collections.records. */
export type ToolGroup = "records" | "recordsData";

export type UploadTarget = { url: string; method: string; headers?: Record<string, string> };

/**
 * The FreeVectorIcons MCP token API as seen by tool handlers. Paths are
 * relative to the API base (for example `/mcp/collections/:id/assets`).
 */
export interface FviApiClient {
  get<T>(path: string, label: string): Promise<T>;
  post<T>(path: string, body: Record<string, unknown>, label: string): Promise<T>;
  put<T>(path: string, body: Record<string, unknown>, label: string): Promise<T>;
  patch<T>(path: string, body: Record<string, unknown>, label: string): Promise<T>;
  delete<T>(path: string, label: string): Promise<T>;
  upload(target: UploadTarget, body: Buffer, label: string): Promise<void>;
  /** Prefixes `path` with the bound collection's MCP API path. */
  collectionPath(path: string): Promise<string>;
}

export interface ToolHost {
  api: FviApiClient;
  limits: ToolLimits;
  /** Present only on local hosts. Without it, `localOnlyInputs` are dropped from schemas. */
  readLocalFile?: (filePath: string) => Promise<Buffer>;
}

/** MCP tool annotations advertised to clients and directory reviewers. */
export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Community catalog reads: first-party, but not confined to one private collection. */
export const COMMUNITY_READ_ANNOTATIONS: ToolAnnotations = {
  ...READ_ANNOTATIONS,
  openWorldHint: true,
};

export const ADDITIVE_WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const REPLACE_WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export const DELETE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  scope: ToolScope;
  capability?: string;
  group?: ToolGroup;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: Shape;
  localOnlyInputs?: Array<keyof Shape & string>;
  handler: (host: ToolHost, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition {
  return definition as unknown as ToolDefinition;
}
