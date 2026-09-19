function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * FVI_TOKEN is required. FVI_COLLECTION_ID is optional (deprecated override):
 * collection id is resolved from the token via GET /mcp/whoami when omitted.
 */
export const config = {
  apiUrl: (process.env.FVI_API_URL || "https://freevectoricons.com/api").replace(/\/$/, ""),
  /** Optional override / legacy. Prefer token-derived collection binding. */
  collectionId: process.env.FVI_COLLECTION_ID?.trim() || undefined,
  token: process.env.FVI_TOKEN,
  readOnly: parseBoolean(process.env.FVI_READ_ONLY, false),
  timeoutMs: parsePositiveInt(process.env.FVI_TIMEOUT_MS, 30_000),
  uploadTimeoutMs: parsePositiveInt(process.env.FVI_UPLOAD_TIMEOUT_MS, 120_000),
  retryMax: parsePositiveInt(process.env.FVI_RETRY_MAX, 3),
  retryBaseMs: parsePositiveInt(process.env.FVI_RETRY_BASE_MS, 500),
  logLevel: (process.env.FVI_LOG_LEVEL || "info").trim().toLowerCase(),
  maxSearchQueryLength: 200,
  maxAssetIdLength: 128,
  maxUploadBytes: 50 * 1024 * 1024,
} as const;
