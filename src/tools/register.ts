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
  return entries;
}
