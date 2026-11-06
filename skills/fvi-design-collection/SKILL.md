---
name: fvi-design-collection
description: >-
  Use when the user needs icons, logos, brand assets or a project's design rules
  and a FreeVectorIcons MCP server is connected: reading a collection's strategy
  brief and DESIGN.md, searching or fetching its SVGs and files, or saving a
  deliverable back into the collection as a new asset or version. Do not use for
  unrelated coding tasks.
---

# FreeVectorIcons design collection

## When to use

- The user asks for icons, a logo, illustrations or other brand assets for the work in front of you
- The user asks what the brand or design rules are, or wants output that follows them
- The user points at a FreeVectorIcons collection or a Setup MCP token
- A deliverable should be saved or versioned back into the same collection

Do not reach for FreeVectorIcons tools for tasks that have nothing to do with design assets or brand rules.

## Setup

The collection comes from `FVI_TOKEN`. Do not ask for a separate collection id unless diagnosing a mismatch.

Tokens are minted at freevectoricons.com → collection → Integrations → Setup MCP. Treat the token like a password: never print it, echo it back, write it into files or include it in commit messages.

## Recommended flow

1. Call `get_collection_context` first. Read the strategy brief and DESIGN.md before choosing or generating any asset, and follow them. If `designSystem.selection` is not `pinned`, ask before pinning one with `set_collection_design_md`.
2. Prefer assets already in the user's collection over drawing new SVG or using the public catalogue. Use `search_collection_assets` or `list_collection_assets` before downloading bytes.
3. Use `get_asset_content` for SVG and Markdown. Use download URLs for PDFs and large binaries; for several files, `get_asset_download_urls` takes up to 50 per call.
4. If the collection has nothing suitable, `list_community_packs` and `get_community_pack_guide` show public packs with their licence and attribution rules. Follow the pack's guide.
5. Write back with `park_asset` or `create_asset_version` only when the user wants the collection updated. Say what you are about to save first. Use `list_asset_versions` and `revert_asset_to_version` to undo; history is never deleted.

## Errors

- `COLLECTION_MISMATCH`: stop. Mint a token for the named collection, or remove a stale collection id override, then reload the MCP server. Signing in again is not a collection switch.
- `TOKEN_MISSING`, `TOKEN_MALFORMED` or `TOKEN_INVALID`: ask the user for a fresh token from Setup MCP.
- `SCOPE_REQUIRED`: the token does not allow that action. Do not retry.
- `CHECKSUM_MISMATCH`: re-read the file and upload again.

## Non-goals

- Do not create collections through MCP
- Do not treat a host's MCP sign-in as retargeting to a different collection
