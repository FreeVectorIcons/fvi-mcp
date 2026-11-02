import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { validateUploadSize } from "./validation.js";

export async function readOptInUploadFile(filePath: string): Promise<Buffer> {
  if (!config.allowFilePaths) {
    throw new Error("filePath uploads are off. Set FVI_ALLOW_FILE_PATHS=true and FVI_FILE_PATH_ROOTS to opt in.");
  }
  if (config.filePathRoots.length === 0) {
    throw new Error("FVI_FILE_PATH_ROOTS is empty. Set it to the directories an agent may read.");
  }
  const resolved = path.resolve(filePath);
  const allowed = config.filePathRoots.some((root) => {
    const rootResolved = path.resolve(root);
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  });
  if (!allowed) {
    throw new Error("filePath is outside FVI_FILE_PATH_ROOTS.");
  }
  const bytes = await readFile(resolved);
  validateUploadSize(bytes.byteLength, config);
  return bytes;
}
