import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { classifyFviToken } from "./token-shape.js";
import { validateBase64Content } from "./validation.js";

{
  const missing = classifyFviToken(undefined);
  assert.equal(missing?.code, "TOKEN_MISSING");
  assert.match(missing?.message ?? "", /Setup MCP/);
}

{
  const url = classifyFviToken("https://freevectoricons.com/collections/col_abc");
  assert.equal(url?.code, "TOKEN_MALFORMED");
  assert.match(url?.message ?? "", /collection URL/);
  assert.match(url?.message ?? "", /col_abc/);
}

{
  assert.match(classifyFviToken("'fvi_col_abcdefghijklmnopqrstuvwxyz012345'")?.message ?? "", /quotes/);
  assert.match(classifyFviToken("Bearer fvi_col_abcdefghijklmnopqrstuvwxyz012345")?.message ?? "", /Bearer/);
  assert.equal(classifyFviToken(`fvi_col_${"a".repeat(43)}`), null);
  assert.equal(classifyFviToken("not-a-token", true), null);
}

{
  const original = Buffer.from("spreadsheet");
  const corruptedText = Buffer.from(original).toString("base64");
  const tweaked = `${corruptedText.slice(0, -2)}aa`;
  const decoded = Buffer.from(tweaked, "base64");
  const expected = createHash("sha256").update(original).digest("hex");
  const actual = createHash("sha256").update(decoded).digest("hex");
  assert.notEqual(expected, actual);
}

{
  assert.throws(() => validateBase64Content("abc"), /base64/);
  assert.throws(() => validateBase64Content("@@@@"), /base64/);
}

console.log("fvi-mcp token shape tests passed");
