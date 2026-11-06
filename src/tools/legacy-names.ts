/**
 * Tool names before the contextual rename (SDA /blog/mcp-tool-naming-sda),
 * mapped to the current name. Old names are accepted on tools/call but never
 * listed: advertising them would bring back the over-length names that
 * Antigravity rejects.
 */
export const LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
  complete_design_asset_upload: "complete_asset_upload",
  create_design_asset_upload: "create_asset_upload",
  create_design_asset_version: "create_asset_version",
  create_design_asset_version_upload: "create_asset_version_upload",
  delete_design_collection_asset: "delete_collection_asset",
  get_design_asset: "get_asset",
  get_design_asset_content: "get_asset_content",
  get_design_asset_download_url: "get_asset_download_url",
  get_design_asset_download_urls: "get_asset_download_urls",
  get_design_asset_spreadsheet_preview: "get_asset_spreadsheet_preview",
  get_design_collection_context: "get_collection_context",
  list_design_asset_versions: "list_asset_versions",
  list_design_collection_assets: "list_collection_assets",
  park_design_asset: "park_asset",
  probe_design_asset_text_layer: "probe_asset_text_layer",
  promote_design_asset_to_strategy_brief: "promote_asset_to_strategy_brief",
  refresh_design_asset_upload: "refresh_asset_upload",
  revert_design_asset_to_version: "revert_asset_to_version",
  search_design_collection_assets: "search_collection_assets",
  update_design_asset: "update_asset",
  update_design_asset_transcription_status: "set_asset_transcription_status",
  update_design_collection_purpose: "update_collection_purpose",
  update_design_collection_strategy_brief: "set_collection_strategy_brief",
};

export function canonicalToolName(name: string): string {
  return Object.hasOwn(LEGACY_TOOL_NAMES, name) ? LEGACY_TOOL_NAMES[name] : name;
}

type ToolCallMessage = { method?: unknown; params?: { name?: unknown } };

type InboundTransport = { onmessage?: (message: never, extra?: never) => void };

/**
 * Call after `server.connect(transport)`: rewrites legacy names on inbound
 * tools/call messages before the server dispatches them.
 */
export function acceptLegacyToolNames(transport: InboundTransport, onLegacyName?: (legacyName: string) => void): void {
  const dispatch = transport.onmessage;
  if (!dispatch) throw new Error("acceptLegacyToolNames must be called after the server is connected.");
  transport.onmessage = (message, extra) => {
    for (const legacyName of canonicalizeToolCalls(message)) onLegacyName?.(legacyName);
    dispatch(message, extra);
  };
}

/**
 * Rewrites a legacy name on one JSON-RPC message, or on each message in a
 * batch, in place. Returns the legacy names it replaced.
 */
export function canonicalizeToolCalls(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const replaced: string[] = [];
  for (const message of messages as ToolCallMessage[]) {
    if (!message || typeof message !== "object" || message.method !== "tools/call") continue;
    const params = message.params;
    if (!params || typeof params.name !== "string") continue;
    const canonical = canonicalToolName(params.name);
    if (canonical === params.name) continue;
    replaced.push(params.name);
    params.name = canonical;
  }
  return replaced;
}
