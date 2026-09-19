---
name: fvi-design-collection
description: >-
  Use when working with a FreeVectorIcons design collection over MCP — reading
  strategy/DESIGN.md context, listing or searching assets, downloading files, or
  parking uploads back into the bound collection.
---

# FreeVectorIcons design collection

## When to use

- The user points at a FreeVectorIcons collection or Setup MCP token
- You need durable project context (strategy brief, DESIGN.md, assets) instead of regenerating SVG from scratch
- You should upload or version a deliverable back into the same collection

## Setup

Collection binding comes from `FVI_TOKEN` (whoami). Do not ask for a separate collection id unless diagnosing a mismatch.

Mint tokens at freevectoricons.com → collection → Integrations → Setup MCP.

## Recommended flow

1. Call `get_design_collection_context` first (metadata, strategy, DESIGN.md pointers).
2. Prefer `search_design_collection_assets` / `list_design_collection_assets` before downloading bytes.
3. Use `get_design_asset_content` for SVG/Markdown; use download URLs for PDFs and large binaries.
4. Write back with `park_design_asset` or `create_design_asset_version` only when the user wants the collection updated.
5. If you see `COLLECTION_MISMATCH`, stop — mint a token for the named collection (or omit a stale collection id override) and reload MCP. `mcp_auth` is not a collection switch.

## Non-goals

- Do not create unlimited collections through MCP
- Do not treat Cursor `mcp_auth` as retargeting to a different collection
