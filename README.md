# @freevectoricons/mcp

> **Beta.** This package is under active development. Tool schemas, configuration options, and error behavior may change before v1.0.0. [Report issues](https://github.com/FreeVectorIcons/fvi-mcp/issues) or review the [product docs](https://freevectoricons.com/mcp) before production use.

Model Context Protocol (MCP) server for [FreeVectorIcons](https://freevectoricons.com) design collections.

Connects Cursor, Claude Desktop, and other MCP clients to a single FreeVectorIcons collection (token-derived binding — configure `FVI_TOKEN` only): catalog icons, uploaded SVGs, strategy briefs, DESIGN.md, and related project files. Access is scoped to one collection token.

npm: [`@freevectoricons/mcp`](https://www.npmjs.com/package/@freevectoricons/mcp)

## Overview

Agents that generate icons inline often produce inconsistent SVG, unstable identifiers, and incorrect licensing across sessions. FreeVectorIcons stores approved assets in versioned collections with stable IDs and metadata.

This server exposes that collection to MCP clients. Agents search and retrieve canonical assets instead of regenerating SVG from scratch, and write designs back into the collection for review. Uploaded assets are versioned, so agents can iterate freely without losing prior work. The server runs over stdio and calls the FreeVectorIcons HTTP API. Responses are metadata-first JSON; file bytes are fetched only when a tool requests inline content or a download URL.

## Requirements

- Node.js 20 or later
- A FreeVectorIcons account
- A collection-scoped MCP token

## Cursor Marketplace (plugin)

This repository is also a **Cursor Plugin** (`.cursor-plugin/plugin.json` + `mcp.json`).

1. Install from Cursor Marketplace once listed, **or** copy this repo to `~/.cursor/plugins/local/freevectoricons` for local testing (copy files; avoid broken symlinks).
2. Open **Plugins → Configure** and set **Collection token** (`FVI_TOKEN`) from FreeVectorIcons → Integrations → Setup MCP.
3. Optional: `FVI_API_URL` (defaults to production), `FVI_READ_ONLY=true` to hide write tools.
4. Collection id is **not** required — `@freevectoricons/mcp@0.2.0-beta.2+` resolves it via whoami.

Submit / re-index: [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

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
        "FVI_API_URL": "https://freevectoricons.com/api",
        "FVI_TOKEN": "<collection-token>"
      }
    }
  }
}
```

Run the server with `npx` as shown above. MCP uses stdio for protocol messages; the process must not write non-protocol output to stdout.

See [`mcp.json.example`](./mcp.json.example) for a copy-paste template.

### macOS (Claude Desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add the same `mcpServers` block.

### Windows (Claude Desktop)

Edit `%APPDATA%\Claude\claude_desktop_config.json` and add the same `mcpServers` block.

### Linux (Claude Desktop)

Edit `~/.config/Claude/claude_desktop_config.json` and add the same `mcpServers` block.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FVI_TOKEN` | yes | — | Collection-scoped MCP token (`fvi_col_*`). Collection binding is derived via `GET /api/mcp/whoami`. |
| `FVI_COLLECTION_ID` | no | — | **Deprecated / override only.** If set and it disagrees with the token’s collection, the adapter fails closed (`COLLECTION_MISMATCH`). Prefer omitting it. |
| `FVI_API_URL` | no | `https://freevectoricons.com/api` | API base URL (include `/api`) |
| `FVI_READ_ONLY` | no | `false` | When `true`, write tools are not registered |
| `FVI_TIMEOUT_MS` | no | `30000` | HTTP request timeout for API calls (milliseconds) |
| `FVI_UPLOAD_TIMEOUT_MS` | no | `120000` | Timeout for binary upload requests (milliseconds) |
| `FVI_RETRY_MAX` | no | `3` | Maximum retry attempts for transient failures |
| `FVI_RETRY_BASE_MS` | no | `500` | Base delay for exponential backoff (milliseconds) |
| `FVI_LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, or `error` (stderr, JSON) |

`FVI_API_URL` can be omitted if you use the production API. The setup example above sets it explicitly for clarity.

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
3. Smoke `get_design_collection_context` and confirm `collection.id` / `name`.
4. Use a second named server entry when two collections must stay connected in parallel.

## Tools

### Read (always available)

| Tool | Description |
|------|-------------|
| `get_design_collection_context` | Collection metadata, strategy brief, asset summary |
| `list_design_collection_assets` | All assets (metadata only) |
| `search_design_collection_assets` | Search by name, tag, category, or style |
| `get_design_asset` | One asset by ID |
| `get_design_asset_content` | Inline UTF-8 for catalog SVGs, uploaded SVGs, Markdown |
| `get_design_asset_download_url` | Short-lived URL for PNG, PDF, spreadsheets (XLS/XLSX), and other binaries |
| `get_design_asset_spreadsheet_preview` | Size-capped first-sheet CSV/HTML preview for XLS/XLSX |

### Write (enabled by default)

| Tool | Description |
|------|-------------|
| `create_design_asset_upload` | Create asset record and signed upload target |
| `park_design_asset` | Upload inline text or base64 into the collection |
| `create_design_asset_version` | Upload a new version of an existing asset (prior versions retained) |
| `update_design_collection_strategy_brief` | Replace `collection.metadata.strategyBrief` (native Strategy Brief tab) |
| `promote_design_asset_to_strategy_brief` | Copy Markdown asset text into the native brief (does not delete the asset) |
| `update_design_asset_transcription_status` | Patch `textLayer` / `transcription` metadata (no OCR) |
| `update_design_asset` | Metadata-only PATCH: name, tags, documentType, DRL fields |
| `delete_design_collection_asset` | Soft-unlink collection item only — does **not** hard-delete bytes |
| `probe_design_asset_text_layer` | Best-effort PDF embedded text probe (API feature-flagged) |

Uploaded assets keep version history in FreeVectorIcons. Agents should prefer `create_design_asset_version` when refining an existing design, and `park_design_asset` for new files. Agents should use metadata and download URLs for images, PDFs, and spreadsheets (`.xls` / `.xlsx`) — workbook bytes are not dumped into MCP tool results. Use `get_design_asset_spreadsheet_preview` for a capped first-sheet look. For scanned PDFs, set transcription status after parking a Markdown sibling.

Parked `STRATEGY_BRIEF.md` is a supporting document only — it does **not** fill the native Strategy Brief tab until you call `promote_design_asset_to_strategy_brief` or `update_design_collection_strategy_brief`.

Optional write metadata: `drlProjectId`, `drlAssetType`, `documentType`, `tags`.

## Limitations

- **Collection-scoped.** One token grants access to one collection, not the global icon catalog.
- **Catalog quality.** Catalog SVGs are AI-generated and refined on a schedule; verify assets before production use.
- **No design review.** The server moves files and metadata; it does not evaluate brand fit.
- **OCR is best-effort.** `probe_design_asset_text_layer` detects embedded PDF text only when enabled on the API; handwritten/scanned pages often have no usable text layer. Failures set `transcription.status=failed` without deleting the asset.
- **Soft unlink, not hard delete.** `delete_design_collection_asset` removes the collection membership only — storage bytes stay until a future hard-delete policy.

## Development

For local API development against a running FVI API server:

```bash
FVI_API_URL=http://localhost:5001/api \
FVI_TOKEN=<collection-token> \
node dist/mcp-server.mjs
```

```bash
npm install
npm run build
npm run smoke
node dist/mcp-server.mjs
```

To run from a local checkout:

```json
"args": ["-y", "file:/absolute/path/to/fvi-mcp"]
```

Build first (`npm run build`). The bundled entry is `dist/mcp-server.mjs`.

### Packaging

Runtime libraries (`@modelcontextprotocol/sdk`, `zod`) are **build-time only**. esbuild inlines them into `dist/mcp-server.mjs`, and published `dependencies` stays empty so `npx` does not install a second unused tree. Add new libraries as `devDependencies`, rebuild, and run `npm run smoke` before publish.

Maintainers still scan build inputs:

```bash
npm run audit:consumer    # install graph consumers see (must stay clean at moderate+)
npm run audit:maintainer  # includes devDependencies (high+)
```

After bumping a build dependency, rebuild and republish so `dist/` picks up the fix. See [Keeping @freevectoricons/mcp vulnerability-free](https://freevectoricons.com/blog/mcp-supply-chain-hardening).

### Publishing (CD only)

Releases are published from GitHub Actions on this repository — not from laptops.

**Who can publish:** only `@hemantasapkota` (hard-coded actor check). The `npm-publish` GitHub Environment further limits deploys to `main` and `v*` tags. When the repo is public, collaborators with write still cannot publish unless that actor gate is updated.

**Triggers**

1. **Manual (preferred):** Actions → **Publish** → Run workflow on `main`, set `confirm_version` to the exact `package.json` version (e.g. `0.2.0-beta.1`).
2. **Tag:** push `v<package.json version>` (e.g. `git tag v0.2.0-beta.1 && git push origin v0.2.0-beta.1`) as `@hemantasapkota`.

**One-time setup (maintainer)**

1. On [npmjs.com](https://www.npmjs.com/) for `@freevectoricons/mcp` → **Trusted Publisher** / Access:
   - GitHub org/user: `FreeVectorIcons`
   - Repository: `fvi-mcp`
   - Workflow filename: `publish.yml`
   - Environment: `npm-publish`
2. Confirm the GitHub Environment `npm-publish` exists (branch/tag policy: `main`, `v*`).
3. No long-lived npm automation token is required in GitHub secrets when trusted publishing is configured.

The workflow runs typecheck, build, smoke, audits, refuses to republish an existing version, then `npm publish --access public --provenance`.

## Related

- [@freevectoricons/mcp package architecture](https://freevectoricons.com/blog/freevectoricons-mcp-package-architecture) — Solution Design Architecture (stdio transport, tool mapping, security boundary)
- [Keeping @freevectoricons/mcp vulnerability-free](https://freevectoricons.com/blog/mcp-supply-chain-hardening) — empty published dependencies, audit gates, Dependabot
- [freevectoricons.com/mcp](https://freevectoricons.com/mcp) — product documentation
- [ai-icon-generator](https://github.com/FreeVectorIcons/ai-icon-generator) — open pipeline for catalog icons

## License

MIT — applies to this MCP server software only. See [LICENSE](./LICENSE).

Icon usage is governed separately by the [FreeVectorIcons Community License](https://freevectoricons.com/license). Attribution may be required depending on your plan and how icons are used.
