import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { ToolDefinition, ToolHost } from "./types.js";

export type RegisteredToolEntry = {
  definition: ToolDefinition;
  tool: ReturnType<McpServer["registerTool"]>;
};

function hostInputSchema(definition: ToolDefinition, host: ToolHost): z.ZodRawShape {
  if (host.readLocalFile || !definition.localOnlyInputs?.length) return definition.inputSchema;
  const localOnly = new Set<string>(definition.localOnlyInputs);
  return Object.fromEntries(
    Object.entries(definition.inputSchema).filter(([key]) => !localOnly.has(key)),
  );
}

/** Recursively drop JSON Schema `$schema` (Gemini function-declarations reject it). */
function stripDollarSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDollarSchema);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$schema") continue;
    out[key] = stripDollarSchema(child);
  }
  return out;
}

type RequestHandlerMap = Map<string, (request: unknown, extra: unknown) => unknown | Promise<unknown>>;

/**
 * Re-wrap tools/list so clients see the SDK schemas without `$schema`.
 * Zod's toJSONSchema (used inside the MCP SDK) always emits draft-07 `$schema`;
 * Gemini's OpenAPI Schema subset rejects that keyword on every tool.
 */
function installSchemaSanitizedListTools(server: McpServer): void {
  const proto = server.server as unknown as { _requestHandlers: RequestHandlerMap };
  const previous = proto._requestHandlers.get("tools/list");
  if (!previous) {
    throw new Error("registerTools: expected MCP SDK tools/list handler before sanitizing schemas");
  }
  proto._requestHandlers.set("tools/list", async (request, extra) => {
    const result = (await previous(request, extra)) as {
      tools: Array<{ inputSchema?: unknown; outputSchema?: unknown }>;
    };
    for (const tool of result.tools ?? []) {
      if (tool.inputSchema) tool.inputSchema = stripDollarSchema(tool.inputSchema);
      if (tool.outputSchema) tool.outputSchema = stripDollarSchema(tool.outputSchema);
    }
    return result;
  });
}

/** Registers definitions in order. Write tools are skipped entirely when `includeWrites` is false. */
export function registerTools(
  server: McpServer,
  host: ToolHost,
  definitions: readonly ToolDefinition[],
  options: { includeWrites: boolean },
): RegisteredToolEntry[] {
  const entries: RegisteredToolEntry[] = [];
  for (const definition of definitions) {
    if (!options.includeWrites && definition.scope !== "read") continue;
    const tool = server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: hostInputSchema(definition, host),
      } as never,
      ((args: Record<string, unknown>) => definition.handler(host, args as never)) as never,
    );
    entries.push({ definition, tool });
  }
  if (entries.length > 0) installSchemaSanitizedListTools(server);
  return entries;
}
