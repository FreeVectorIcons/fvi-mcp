import { config } from "./config.js";
import { fviGet } from "./http-client.js";
import { logger } from "./logger.js";

export type McpWhoamiResponse = {
  tokenId: string;
  collectionId: string;
  ownerUserId?: string;
  tokenKind?: string;
  collection?: {
    id: string;
    name?: string;
    type?: string;
    visibility?: string;
  } | null;
};

let cachedCollectionId: string | null = null;
let resolvePromise: Promise<string> | null = null;

function mismatchError(configured: string, bound: string, setupUrl?: string): Error {
  const payload = {
    error: "COLLECTION_MISMATCH",
    configuredCollectionId: configured,
    boundCollectionId: bound,
    setupUrl: setupUrl ?? `https://freevectoricons.com/collections/${encodeURIComponent(bound)}`,
    hint:
      "FVI_COLLECTION_ID does not match the collection bound to FVI_TOKEN. Omit FVI_COLLECTION_ID (recommended) or set it to the token's collection id, then reload the MCP server.",
  };
  return new Error(`FVI API 409: ${JSON.stringify(payload)}`);
}

/**
 * Resolve the collection id for this process.
 * Uses GET /mcp/whoami when FVI_COLLECTION_ID is omitted, and fails closed when
 * an optional env override disagrees with the token binding.
 */
export async function resolveCollectionId(): Promise<string> {
  if (cachedCollectionId) return cachedCollectionId;
  if (resolvePromise) return resolvePromise;

  resolvePromise = (async () => {
    const whoami = await fviGet<McpWhoamiResponse>("/mcp/whoami", "mcp_whoami");
    if (!whoami?.collectionId) {
      throw new Error("FVI whoami did not return a collectionId for this token.");
    }

    if (config.collectionId && config.collectionId !== whoami.collectionId) {
      const setupUrl = whoami.collection?.id
        ? `https://freevectoricons.com/collections/${encodeURIComponent(whoami.collectionId)}`
        : undefined;
      throw mismatchError(config.collectionId, whoami.collectionId, setupUrl);
    }

    cachedCollectionId = whoami.collectionId;
    logger.info("collection.resolved", {
      collectionId: cachedCollectionId,
      source: config.collectionId ? "env+whoami" : "whoami",
      tokenId: whoami.tokenId,
      collectionName: whoami.collection?.name ?? null,
    });
    return cachedCollectionId;
  })();

  try {
    return await resolvePromise;
  } catch (error) {
    resolvePromise = null;
    throw error;
  }
}

export async function collectionPath(path: string): Promise<string> {
  const collectionId = await resolveCollectionId();
  return `/mcp/collections/${encodeURIComponent(collectionId)}${path}`;
}

/** Test helper */
export function resetResolvedCollectionIdForTests(): void {
  cachedCollectionId = null;
  resolvePromise = null;
}
