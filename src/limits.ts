export type ToolLimits = {
  maxSearchQueryLength: number;
  maxAssetIdLength: number;
  maxUploadBytes: number;
};

export const DEFAULT_TOOL_LIMITS: ToolLimits = {
  maxSearchQueryLength: 200,
  maxAssetIdLength: 128,
  maxUploadBytes: 50 * 1024 * 1024,
};
