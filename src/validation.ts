import { config } from "./config.js";

const ASSET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function validateSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query is required.");
  }
  if (trimmed.length > config.maxSearchQueryLength) {
    throw new Error(`Search query must be at most ${config.maxSearchQueryLength} characters.`);
  }
  return trimmed;
}

export function validateAssetId(assetId: string): string {
  const trimmed = assetId.trim();
  if (!trimmed) {
    throw new Error("assetId is required.");
  }
  if (trimmed.length > config.maxAssetIdLength) {
    throw new Error(`assetId must be at most ${config.maxAssetIdLength} characters.`);
  }
  if (!ASSET_ID_PATTERN.test(trimmed)) {
    throw new Error("assetId contains unsupported characters. Use letters, numbers, dots, colons, underscores, or hyphens.");
  }
  return trimmed;
}

export function validateUploadSize(sizeBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Upload size must be a positive integer number of bytes.");
  }
  if (sizeBytes > config.maxUploadBytes) {
    throw new Error(`Upload exceeds the ${config.maxUploadBytes} byte limit.`);
  }
}

export function validateSvgTextContent(textContent: string): void {
  const trimmed = textContent.trim();
  if (!trimmed) {
    throw new Error("SVG textContent is empty.");
  }
  if (!/<svg[\s>]/i.test(trimmed)) {
    throw new Error("SVG textContent must include an <svg> element.");
  }
  if (!/viewBox\s*=/i.test(trimmed)) {
    throw new Error("SVG textContent is missing a viewBox attribute.");
  }
}

export function validateBase64Content(contentBase64: string): void {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new Error("contentBase64 is empty.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("contentBase64 is not valid base64.");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 0) {
    throw new Error("contentBase64 decoded to an empty payload.");
  }
  validateUploadSize(decoded.length);
}

export function validateWriteContent(input: {
  contentType: string;
  textContent?: string;
  contentBase64?: string;
}): void {
  if (typeof input.textContent === "string" && typeof input.contentBase64 === "string") {
    throw new Error("Provide either textContent or contentBase64, not both.");
  }
  if (input.contentType === "image/svg+xml" && typeof input.textContent === "string") {
    validateSvgTextContent(input.textContent);
    validateUploadSize(Buffer.byteLength(input.textContent, "utf8"));
    return;
  }
  if (typeof input.textContent === "string") {
    validateUploadSize(Buffer.byteLength(input.textContent, "utf8"));
    return;
  }
  if (typeof input.contentBase64 === "string") {
    validateBase64Content(input.contentBase64);
    return;
  }
  throw new Error("textContent or contentBase64 is required.");
}
