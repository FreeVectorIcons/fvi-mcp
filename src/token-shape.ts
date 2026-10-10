const TOKEN_PREFIX = "fvi_col_";

export type TokenShapeProblem = {
  code: "TOKEN_MISSING" | "TOKEN_MALFORMED";
  message: string;
};

export function classifyFviToken(token: string | undefined, skip = false): TokenShapeProblem | null {
  if (skip) return null;
  if (token == null || token.trim() === "") {
    return {
      code: "TOKEN_MISSING",
      message: "FVI_TOKEN is not set. Mint one in your collection → Integrations → Setup MCP.",
    };
  }
  if (/^bearer\s+/i.test(token)) {
    return {
      code: "TOKEN_MALFORMED",
      message: "FVI_TOKEN includes a Bearer prefix. Paste the token only. Tokens start with fvi_col_.",
    };
  }
  if (token.startsWith('"') || token.startsWith("'") || token.endsWith('"') || token.endsWith("'")) {
    return {
      code: "TOKEN_MALFORMED",
      message: "FVI_TOKEN includes surrounding quotes. Paste the token without quotes.",
    };
  }
  if (token !== token.trim() || /\s/.test(token)) {
    return {
      code: "TOKEN_MALFORMED",
      message: "FVI_TOKEN contains whitespace. Paste the token only, without spaces or line breaks.",
    };
  }
  const looksLikeUrl =
    /^https?:\/\//i.test(token) ||
    token.includes("freevectoricons.com") ||
    token.includes("/collections/");
  if (looksLikeUrl) {
    const collectionId = token.match(/\/collections\/([A-Za-z0-9._:-]+)/)?.[1];
    const where = collectionId
      ? ` Mint one for that collection under Integrations → Setup MCP (collection ${collectionId}).`
      : " Mint one under Integrations → Setup MCP.";
    return {
      code: "TOKEN_MALFORMED",
      message: `FVI_TOKEN looks like a collection URL, not a token. Tokens start with ${TOKEN_PREFIX}.${where}`,
    };
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    return {
      code: "TOKEN_MALFORMED",
      message: `FVI_TOKEN does not look like a FreeVectorIcons collection token (expected ${TOKEN_PREFIX}…).`,
    };
  }
  const secret = token.slice(TOKEN_PREFIX.length);
  if (secret.length < 20 || secret.length > 128 || !/^[A-Za-z0-9_-]+$/.test(secret)) {
    return {
      code: "TOKEN_MALFORMED",
      message: `FVI_TOKEN does not look like a FreeVectorIcons collection token (expected ${TOKEN_PREFIX}…).`,
    };
  }
  return null;
}
