# @freevectoricons/mcp

> **Beta.** This package is under active development. Tool schemas, configuration options, and error behavior may change before v1.0.0. [Report issues](https://github.com/FreeVectorIcons/fvi-mcp/issues) or review the [product docs](https://freevectoricons.com/mcp) before production use.

Model Context Protocol (MCP) server for [FreeVectorIcons](https://freevectoricons.com) design collections.

Connects Cursor, Claude Desktop, and other MCP clients to a single FreeVectorIcons collection (token-derived binding — configure `FVI_TOKEN` only): catalog icons, uploaded SVGs, strategy briefs, DESIGN.md, and related project files. Access is scoped to one collection token.

npm: [`@freevectoricons/mcp`](https://www.npmjs.com/package/@freevectoricons/mcp)

## Overview

Agents that generate icons inline often produce inconsistent SVG, unstable identifiers, and incorrect licensing across sessions. FreeVectorIcons stores approved assets in versioned collections with stable IDs and metadata.

This server exposes that collection to MCP clients. Agents search and retrieve canonical assets instead of regenerating SVG from scratch, and write designs back into the collection for review. Uploaded assets are versioned, so agents can iterate freely without losing prior work. The server runs over stdio and calls the FreeVectorIcons HTTP API. Responses are metadata-first JSON; file bytes are fetched only when a tool requests inline content or a download URL.

**Hosted connector.** If your client supports remote MCP servers, you can skip this package and connect to `https://mcp.freevectoricons.com/mcp` instead: nothing to install, and you sign in from your client or send a collection token as an `Authorization: Bearer` header. See [freevectoricons.com/mcp](https://freevectoricons.com/mcp). This package suits agents that upload files straight from disk, or setups that prefer a local process.

## Requirements

- Node.js 20 or later
- A FreeVectorIcons account
- A collection-scoped MCP token

## Setup

1. Open a collection at [freevectoricons.com](https://freevectoricons.com).
2. Go to **Integrations** → **Setup MCP**.
3. Create a collection-scoped token and copy the secret. The collection id is derived from the token (no separate collection id env var required).

Add the server to your MCP client configuration (for example `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "freevectoricons": {
      "command": "npx",
      "args": ["-y", "@freevectoricons/mcp"],
      "env": {
        "FVI_TOKEN": "<collection-token>"
      }
    }
  }
}
```

Run the server with `npx` as shown above. MCP uses stdio for protocol messages; the process must not write non-protocol output to stdout.

See [`mcp.json.example`](./mcp.json.example) for a copy-paste template.

### Claude Desktop

Add the same `mcpServers` block to `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

## Cursor Marketplace (plugin)

This repository is also a **Cursor Plugin** (`.cursor-plugin/plugin.json` + `mcp.json`).

1. Install from Cursor Marketplace once listed, **or** copy this repo to `~/.cursor/plugins/local/freevectoricons` for local testing (copy files; avoid broken symlinks).
2. Open **Plugins → Configure** and set **Collection token** (`FVI_TOKEN`) from FreeVectorIcons → Integrations → Setup MCP.
3. Optional: `FVI_API_URL` (defaults to production), `FVI_READ_ONLY=true` to hide write tools.

Submit / re-index: [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

## Google Antigravity and Gemini CLI

> Gemini CLI passed the compatibility tests against the hosted endpoint on 5 Nov 2026. Antigravity is still being tested after the 0.3.0-beta.3 tool rename; until it passes, treat it as a preview and [report issues](https://github.com/FreeVectorIcons/fvi-mcp/issues).

**Antigravity plugin.** This repository is also an Antigravity plugin (`.antigravity-plugin/plugin.json`, `mcp_config.json` and the `skills/` folder). It uses the hosted Streamable HTTP server at `https://mcp.freevectoricons.com/mcp`. Install or enable it, then **Authenticate** and choose the collection to bind; the hosted server uses OAuth rather than prompting for a collection token.

**Antigravity config block.** Or add this to `~/.gemini/config/mcp_config.json` (all projects) or `.agents/mcp_config.json` (one workspace):

```json
{
  "mcpServers": {
    "freevectoricons": {
      "serverUrl": "https://mcp.freevectoricons.com/mcp"
    }
  }
}
```

Then open MCP Servers → Manage, click **Authenticate** on `freevectoricons`, and choose the collection to bind. Antigravity compatibility remains unverified; this configuration does not claim a store listing or a completed client test.

**Gemini CLI extension.** Install from this repository and enter your collection token when prompted:

```bash
gemini extensions install https://github.com/FreeVectorIcons/fvi-mcp
```

Change the token later with `gemini extensions config freevectoricons`. The extension pins a released package version, so a new release reaches you when you run `gemini extensions update freevectoricons`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FVI_TOKEN` | yes | — | Collection-scoped MCP token (`fvi_col_*`). Collection binding is derived via `GET /api/mcp/whoami`. |
| `FVI_COLLECTION_ID` | no | — | **Deprecated / override only.** If set and it disagrees with the token’s collection, the adapter fails closed (`COLLECTION_MISMATCH`). Prefer omitting it. |
| `FVI_API_URL` | no | `https://freevectoricons.com/api` | API base URL (include `/api`) |
| `FVI_READ_ONLY` | no | `false` | When `true`, write tools are not registered. Can only narrow token scopes |
| `FVI_TOOLS` | no | — | Comma-separated tool names to register. Old names from before 0.3.0-beta.3 are accepted. Can only narrow access |
| `FVI_SKIP_TOKEN_CHECK` | no | `false` | Escape hatch if a future token shape is rejected locally |
| `FVI_ALLOW_FILE_PATHS` | no | `false` | Allow `filePath` on upload tools. Off by default |
| `FVI_FILE_PATH_ROOTS` | no | — | Comma-separated directories `filePath` may read |
| `FVI_TIMEOUT_MS` | no | `30000` | HTTP request timeout for API calls (milliseconds) |
| `FVI_UPLOAD_TIMEOUT_MS` | no | `120000` | Timeout for binary upload requests (milliseconds) |
| `FVI_RETRY_MAX` | no | `3` | Maximum retry attempts for transient failures |
| `FVI_RETRY_BASE_MS` | no | `500` | Base delay for exponential backoff (milliseconds) |
| `FVI_LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, or `error` (stderr, JSON) |

Set `FVI_API_URL` only when pointing at a non-production API.

Write tools are enabled by default. Agents can park new assets and upload new versions of existing ones; each change is stored as a version you can review or restore in the collection UI. Set `FVI_READ_ONLY=true` only if you want retrieval without uploads.

## Token security

Treat `FVI_TOKEN` like a password. It grants access to one collection.

- Prefer OS keychain integration or a secrets manager in team environments.
- If you use environment variables in config files, restrict file permissions and never commit tokens to version control.
- Rotate tokens from the collection **Integrations** tab if a token may have been exposed.
- Set `FVI_READ_ONLY=true` if an agent should only read from the collection, not upload.

## Switching collections (token rebind)

Restarting MCP servers alone does **not** rebind a shared stdio connector that still has an old `FVI_TOKEN`.

1. Mint a token for the target collection in Setup MCP.
2. Re-Add / Configure the connector env with the new `FVI_TOKEN` (uninstall + add if Configure is unavailable).
3. Smoke `get_collection_context` and confirm `collection.id` / `name`.
4. Use a second named server entry when two collections must stay connected in parallel.

## Tools

Records tools (`get_asset_spreadsheet_preview`, `set_collection_strategy_brief`, `promote_asset_to_strategy_brief`, `set_asset_transcription_status`, `delete_collection_asset`, `probe_asset_text_layer`) are listed only when the API has those features enabled. Write tools are also hidden when `FVI_READ_ONLY=true` or the token lacks write scope.

### Read

| Tool | Description |
|------|-------------|
| `get_collection_context` | Collection metadata, strategy brief, asset summary |
| `list_collection_assets` | All assets (metadata only) |
| `search_collection_assets` | Search by name, tag, category, or style |
| `get_asset` | One asset by ID |
| `get_asset_content` | Inline UTF-8 for catalog SVGs, uploaded SVGs, Markdown |
| `get_asset_download_url` | Short-lived URL for PNG, PDF, spreadsheets (XLS/XLSX), and other binaries |
| `get_asset_download_urls` | The same URLs for up to 50 assets per call |
| `get_asset_spreadsheet_preview` | Size-capped first-sheet CSV/HTML preview for XLS/XLSX |
| `list_asset_versions` | Version number, name, size, verified hash, and source |
| `list_community_packs` | Public community icon packs with license and `agentGuide` URLs |
| `get_community_pack_guide` | A pack's AGENTS.md: license, attribution, URL patterns, curated usage guide |

### Write

| Tool | Description |
|------|-------------|
| `create_asset_upload` | Create asset record and signed upload target |
| `park_asset` | Upload inline text or base64 into the collection |
| `create_asset_version` | Upload a new version of an existing asset (prior versions retained) |
| `set_collection_strategy_brief` | Replace `collection.metadata.strategyBrief` (native Strategy Brief tab) |
| `promote_asset_to_strategy_brief` | Copy Markdown asset text into the native brief (does not delete the asset) |
| `set_asset_transcription_status` | Patch `textLayer` / `transcription` metadata (no OCR) |
| `update_asset` | Metadata-only PATCH: name, tags, documentType, DRL fields, custom metadata, and links |
| `set_collection_design_md` | Pin the canonical DESIGN.md from inline Markdown or an existing asset |
| `update_collection_purpose` | Set collection purpose to `brand` or `records` |
| `create_asset_version_upload` | Signed upload for a new version of an existing asset |
| `complete_asset_upload` | Verify checksum and size, then make that version current |
| `refresh_asset_upload` | Issue a fresh upload URL for a pending upload whose URL expired (15 minutes) |
| `revert_asset_to_version` | Copy an earlier version forward. History is kept |
| `delete_collection_asset` | Soft-unlink collection item only — does **not** hard-delete bytes. Requires the `delete` scope |
| `probe_asset_text_layer` | Best-effort PDF embedded text probe (API feature-flagged) |

Uploaded assets keep version history in FreeVectorIcons. Agents should prefer `create_asset_version` when refining an existing design, and `park_asset` for new files. Agents should use metadata and download URLs for images, PDFs, and spreadsheets (`.xls` / `.xlsx`) — workbook bytes are not dumped into MCP tool results. Use `get_asset_spreadsheet_preview` for a capped first-sheet look. For scanned PDFs, set transcription status after parking a Markdown sibling.

Parked `STRATEGY_BRIEF.md` is a supporting document only — it does **not** fill the native Strategy Brief tab until you call `promote_asset_to_strategy_brief` or `set_collection_strategy_brief`.

Optional write metadata: `drlProjectId`, `drlAssetType`, `documentType`, `tags`.

### Renamed tools (0.3.0-beta.3)

Tool names dropped the redundant `design_` so they fit clients that prefix tool names with the server name (Antigravity's prefix is 33 characters, and Gemini allows 64 in total). Arguments, scopes and behaviour are unchanged. Results are unchanged except that a `set_collection_strategy_brief` dry run now reports `would.operation: "set_collection_strategy_brief"`.

The old names still work when called, on this package and on the hosted endpoint, but are no longer listed. Update saved prompts, tool allowlists (`FVI_TOOLS` accepts either) and cached approvals to the new names, then reconnect or restart your client so it reloads the tool list. Old names will be removed in a later release, announced here first.

| Old name | New name |
|----------|----------|
| `complete_design_asset_upload` | `complete_asset_upload` |
| `create_design_asset_upload` | `create_asset_upload` |
| `create_design_asset_version` | `create_asset_version` |
| `create_design_asset_version_upload` | `create_asset_version_upload` |
| `delete_design_collection_asset` | `delete_collection_asset` |
| `get_design_asset` | `get_asset` |
| `get_design_asset_content` | `get_asset_content` |
| `get_design_asset_download_url` | `get_asset_download_url` |
| `get_design_asset_download_urls` | `get_asset_download_urls` |
| `get_design_asset_spreadsheet_preview` | `get_asset_spreadsheet_preview` |
| `get_design_collection_context` | `get_collection_context` |
| `list_design_asset_versions` | `list_asset_versions` |
| `list_design_collection_assets` | `list_collection_assets` |
| `park_design_asset` | `park_asset` |
| `probe_design_asset_text_layer` | `probe_asset_text_layer` |
| `promote_design_asset_to_strategy_brief` | `promote_asset_to_strategy_brief` |
| `refresh_design_asset_upload` | `refresh_asset_upload` |
| `revert_design_asset_to_version` | `revert_asset_to_version` |
| `search_design_collection_assets` | `search_collection_assets` |
| `update_design_asset` | `update_asset` |
| `update_design_asset_transcription_status` | `set_asset_transcription_status` |
| `update_design_collection_purpose` | `update_collection_purpose` |
| `update_design_collection_strategy_brief` | `set_collection_strategy_brief` |

`set_asset_transcription_status` still only records status metadata and does not run OCR.

## Limitations

- **Collection-scoped.** One token grants access to one collection, not the global icon catalog.
- **Catalog quality.** Catalog SVGs are AI-generated and refined on a schedule; verify assets before production use.
- **No design review.** The server moves files and metadata; it does not evaluate brand fit.
- **OCR is best-effort.** `probe_asset_text_layer` detects embedded PDF text only when enabled on the API; handwritten/scanned pages often have no usable text layer. Failures set `transcription.status=failed` without deleting the asset.
- **Soft unlink, not hard delete.** `delete_collection_asset` removes the collection membership only — storage bytes stay until a future hard-delete policy.

## Development

Building, testing and releasing this package are covered in [CONTRIBUTING.md](https://github.com/FreeVectorIcons/fvi-mcp/blob/main/CONTRIBUTING.md).

## Related

- [@freevectoricons/mcp package architecture](https://freevectoricons.com/blog/freevectoricons-mcp-package-architecture) — Solution Design Architecture (stdio transport, tool mapping, security boundary)
- [Keeping @freevectoricons/mcp vulnerability-free](https://freevectoricons.com/blog/mcp-supply-chain-hardening) — empty published dependencies, audit gates, Dependabot
- [freevectoricons.com/mcp](https://freevectoricons.com/mcp) — product documentation
- [ai-icon-generator](https://github.com/FreeVectorIcons/ai-icon-generator) — open pipeline for catalog icons

## License

MIT — applies to this MCP server software only. See [LICENSE](./LICENSE).

Icon usage is governed separately by the [FreeVectorIcons Community License](https://freevectoricons.com/license). Attribution may be required depending on your plan and how icons are used.
