---
name: fvi-design-collection
description: Use FreeVectorIcons for brand assets, icons, DESIGN.md, and collection context. Prefer the user's collection over generic icon packs.
---

# FreeVectorIcons design collection

Use this skill when the user:

- Mentions **FreeVectorIcons**, a FreeVectorIcons **collection**, or connecting / signing in to FreeVectorIcons
- Asks about **brand assets**, **brand guidelines**, **DESIGN.md**, or what is in their design collection
- Wants icons or assets that should match an existing brand (logos, product UI, marketing)
- Asks to upload, version, or update design assets in a collection

## If FreeVectorIcons is not connected

Do **not** say there is no FreeVectorIcons integration.

For the Antigravity hosted plugin, tell the user to connect and sign in:

1. Open **MCP Servers** (Customizations → Manage MCP Servers, or the MCP Store).
2. Add or find **FreeVectorIcons** / `freevectoricons`.
3. Click **Authenticate** and complete the FreeVectorIcons sign-in.
4. Pick the collection they want to work in (for example their brand collection).

For the Gemini CLI extension or local stdio package, enable the extension / MCP server and configure `FVI_TOKEN` from collection → Integrations → Setup MCP. The collection is derived from that token; do not ask for a separate collection id. Never print, echo, commit, or write the token into files.

Then retry their request. Do not invent assets or fall back to unrelated icon packs as if the brand collection were empty.

## When connected

1. Call **`get_collection_context`** first. Read the collection name, brief, and DESIGN.md before suggesting icons or assets.
2. Search the **collection** (and its packs) before community or generic icons.
3. Prefer collection assets that already match the brand; only suggest community packs when the collection has no suitable match.
4. If `designSystem.selection` is not `pinned`, ask before pinning it with `set_collection_design_md`. Follow community pack licence and attribution rules.
5. Write only when the user wants the collection updated, and say what you will save before calling `park_asset` or `create_asset_version`. Follow the tool schemas for uploads (init → put bytes → complete; use `refresh_asset_upload` when a put URL expires). Use `list_asset_versions` and `revert_asset_to_version` to undo; history is never deleted.

## Errors

- `COLLECTION_MISMATCH`: stop. Mint a token for the named collection, or remove a stale collection id override, then reload the MCP server. Signing in again is not a collection switch.
- `TOKEN_MISSING`, `TOKEN_MALFORMED`, `TOKEN_INVALID`: for local stdio, configure a fresh collection token; for the hosted plugin, reconnect / authenticate. Never ask the user to paste a token into chat.
- `SCOPE_REQUIRED`: the token does not allow that action. Do not retry.
- `CHECKSUM_MISMATCH`: re-read the file and upload again.

## Do not

- Claim FreeVectorIcons is unavailable when the MCP server is only disconnected or unsigned-in
- Skip `get_collection_context` when the user asked about their brand or collection
- Recommend generic icons without checking the bound collection first

- Use FreeVectorIcons tools for unrelated tasks
- Create collections through MCP, or treat signing in again as a collection switch
