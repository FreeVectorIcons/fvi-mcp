import { config } from "./config.js";
import { logger } from "./logger.js";

type JsonRecord = { [key: string]: unknown };

type FviRequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: JsonRecord | Uint8Array | Buffer;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryPost?: boolean;
  label: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up")
  );
}

async function readErrorPayload(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

async function fviRequest(path: string, options: FviRequestOptions): Promise<Response> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const url = `${config.apiUrl}${path}`;
  const token = config.token;
  if (!token) {
    throw new Error("FVI_TOKEN is required");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.headers ?? {}),
  };

  let body: string | Uint8Array | Buffer | undefined;
  if (options.body instanceof Uint8Array || Buffer.isBuffer(options.body)) {
    body = options.body;
  } else if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const maxAttempts = method === "GET" || options.retryPost ? config.retryMax + 1 : 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delayMs = config.retryBaseMs * 2 ** (attempt - 1);
      logger.warn("http.retry", {
        label: options.label,
        method,
        path,
        attempt,
        delayMs,
      });
      await sleep(delayMs);
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startedAt;
      logger.debug("http.response", {
        label: options.label,
        method,
        path,
        status: response.status,
        latencyMs,
        attempt,
      });

      if (response.ok) {
        return response;
      }

      const payload = await readErrorPayload(response);
      const error = new Error(`FVI API ${response.status}: ${payload || response.statusText}`);
      lastError = error;

      if (attempt < maxAttempts - 1 && isRetryableStatus(response.status)) {
        continue;
      }

      throw error;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof Error && error.message.startsWith("FVI API ")) {
        throw error;
      }

      const wrapped = error instanceof Error ? error : new Error(String(error));
      lastError = wrapped;
      logger.warn("http.error", {
        label: options.label,
        method,
        path,
        latencyMs,
        attempt,
        message: wrapped.message,
      });

      if (attempt < maxAttempts - 1 && isRetryableError(wrapped)) {
        continue;
      }

      if (wrapped.name === "AbortError") {
        throw new Error(`FVI API request timed out after ${timeoutMs}ms (${options.label}).`);
      }

      throw wrapped;
    }
  }

  throw lastError ?? new Error(`FVI API request failed (${options.label}).`);
}

export async function fviGet<T>(path: string, label: string): Promise<T> {
  const response = await fviRequest(path, { method: "GET", label });
  return response.json() as Promise<T>;
}

export async function fviPost<T>(path: string, body: JsonRecord, label: string): Promise<T> {
  const response = await fviRequest(path, {
    method: "POST",
    body,
    label,
    retryPost: true,
  });
  return response.json() as Promise<T>;
}

export async function uploadBody(
  upload: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  },
  body: Uint8Array | Buffer,
  label: string,
): Promise<void> {
  const resolvedUrl = resolveUploadUrl(upload.url);
  const uploadUrl = new URL(resolvedUrl);
  const apiOrigin = new URL(config.apiUrl).origin;
  const headers: Record<string, string> = {
    ...(upload.headers ?? {}),
  };
  if (uploadUrl.origin === apiOrigin && uploadUrl.pathname.startsWith("/api/mcp/")) {
    const token = config.token;
    if (!token) throw new Error("FVI_TOKEN is required");
    headers.Authorization = `Bearer ${token}`;
  }

  const maxAttempts = config.retryMax + 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delayMs = config.retryBaseMs * 2 ** (attempt - 1);
      logger.warn("upload.retry", { label, attempt, delayMs, url: resolvedUrl });
      await sleep(delayMs);
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(resolvedUrl, {
        method: upload.method,
        headers,
        body,
        signal: AbortSignal.timeout(config.uploadTimeoutMs),
      });

      logger.debug("upload.response", {
        label,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        attempt,
      });

      if (response.ok) return;

      const payload = await readErrorPayload(response);
      const error = new Error(`FVI upload ${response.status}: ${payload || response.statusText}`);
      lastError = error;

      if (attempt < maxAttempts - 1 && isRetryableStatus(response.status)) {
        continue;
      }

      throw error;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("FVI upload ")) {
        throw error;
      }

      const wrapped = error instanceof Error ? error : new Error(String(error));
      lastError = wrapped;
      if (attempt < maxAttempts - 1 && isRetryableError(wrapped)) {
        continue;
      }

      if (wrapped.name === "AbortError") {
        throw new Error(`FVI upload timed out after ${config.uploadTimeoutMs}ms (${label}).`);
      }

      throw wrapped;
    }
  }

  throw lastError ?? new Error(`FVI upload failed (${label}).`);
}

function resolveUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(config.apiUrl).origin;
  return new URL(url, origin).toString();
}
