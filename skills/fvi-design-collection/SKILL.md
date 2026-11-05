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

Tell the user to connect and sign in:

1. Open **MCP Servers** (Customizations → Manage MCP Servers, or the MCP Store).
2. Add or find **FreeVectorIcons** / `freevectoricons`.
3. Click **Authenticate** and complete the FreeVectorIcons sign-in.
4. Pick the collection they want to work in (for example their brand collection).

Then retry their request. Do not invent assets or fall back to unrelated icon packs as if the brand collection were empty.

## When connected

1. Call **`get_design_collection_context`** first. Read the collection name, brief, and DESIGN.md before suggesting icons or assets.
2. Search the **collection** (and its packs) before community or generic icons.
3. Prefer collection assets that already match the brand; only suggest community packs when the collection has no suitable match.
4. For uploads and versions, follow the tool schemas (init → put bytes → complete; use `refresh_design_asset_upload` when a put URL expires).

## Do not

- Claim FreeVectorIcons is unavailable when the MCP server is only disconnected or unsigned-in
- Skip `get_design_collection_context` when the user asked about their brand or collection
- Recommend generic icons without checking the bound collection first
