import { createHash } from "node:crypto";
import { DEFAULT_TOOL_LIMITS, type ToolLimits } from "./limits.js";

const ASSET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function validateSearchQuery(query: string, limits: ToolLimits = DEFAULT_TOOL_LIMITS): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query is required.");
  }
  if (trimmed.length > limits.maxSearchQueryLength) {
    throw new Error(`Search query must be at most ${limits.maxSearchQueryLength} characters.`);
  }
  return trimmed;
}

export function validateAssetId(assetId: string, limits: ToolLimits = DEFAULT_TOOL_LIMITS): string {
  const trimmed = assetId.trim();
  if (!trimmed) {
    throw new Error("assetId is required.");
  }
  if (trimmed.length > limits.maxAssetIdLength) {
    throw new Error(`assetId must be at most ${limits.maxAssetIdLength} characters.`);
  }
  if (!ASSET_ID_PATTERN.test(trimmed)) {
    throw new Error("assetId contains unsupported characters. Use letters, numbers, dots, colons, underscores, or hyphens.");
  }
  return trimmed;
}

export function validateUploadSize(sizeBytes: number, limits: ToolLimits = DEFAULT_TOOL_LIMITS): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Upload size must be a positive integer number of bytes.");
  }
  if (sizeBytes > limits.maxUploadBytes) {
    throw new Error(`Upload exceeds the ${limits.maxUploadBytes} byte limit.`);
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

export function validateBase64Content(contentBase64: string, limits: ToolLimits = DEFAULT_TOOL_LIMITS): void {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new Error("contentBase64 is empty.");
  }
  if (trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("contentBase64 is not valid base64.");
  }
  const decoded = Buffer.from(trimmed, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  if (canonical !== trimmed.replace(/=+$/, "")) {
    throw new Error("contentBase64 is not valid base64.");
  }
  if (decoded.length === 0) {
    throw new Error("contentBase64 decoded to an empty payload.");
  }
  validateUploadSize(decoded.length, limits);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash of decoded bytes. A supplied checksum that does not match fails before any network call. */
export function assertDecodedChecksum(bytes: Buffer, supplied?: string): string {
  const actual = sha256Hex(bytes);
  if (!supplied?.trim()) return actual;
  const expected = supplied.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("checksumSha256 must be a 64-character hex SHA-256 of the decoded bytes.");
  }
  if (expected !== actual) {
    throw new Error(
      `Checksum mismatch before upload. expected ${expected} actual ${actual}. The hash covers the decoded file bytes, not the base64 text.`,
    );
  }
  return actual;
}

export function validateWriteContent(
  input: {
    contentType: string;
    textContent?: string;
    contentBase64?: string;
  },
  limits: ToolLimits = DEFAULT_TOOL_LIMITS,
): void {
  if (typeof input.textContent === "string" && typeof input.contentBase64 === "string") {
    throw new Error("Provide either textContent or contentBase64, not both.");
  }
  if (input.contentType === "image/svg+xml" && typeof input.textContent === "string") {
    validateSvgTextContent(input.textContent);
    validateUploadSize(Buffer.byteLength(input.textContent, "utf8"), limits);
    return;
  }
  if (typeof input.textContent === "string") {
    validateUploadSize(Buffer.byteLength(input.textContent, "utf8"), limits);
    return;
  }
  if (typeof input.contentBase64 === "string") {
    validateBase64Content(input.contentBase64, limits);
    return;
  }
  throw new Error("textContent or contentBase64 is required.");
}
