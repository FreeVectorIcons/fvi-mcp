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

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  scope: ToolScope;
  capability?: string;
  group?: ToolGroup;
  title: string;
  description: string;
  inputSchema: Shape;
  localOnlyInputs?: Array<keyof Shape & string>;
  handler: (host: ToolHost, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition {
  return definition as unknown as ToolDefinition;
}
