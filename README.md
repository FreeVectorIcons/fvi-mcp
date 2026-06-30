# @freevectoricons/mcp

> **Beta.** This package is under active development. Tool schemas, configuration options, and error behavior may change before v1.0.0. [Report issues](https://github.com/FreeVectorIcons/fvi-mcp/issues) or review the [product docs](https://freevectoricons.com/mcp) before production use.

Model Context Protocol (MCP) server for [FreeVectorIcons](https://freevectoricons.com) design collections.

Connects Cursor, Claude Desktop, and other MCP clients to a single FreeVectorIcons collection: catalog icons, uploaded SVGs, strategy briefs, DESIGN.md, and related project files. Access is scoped to one collection token.

npm: [`@freevectoricons/mcp`](https://www.npmjs.com/package/@freevectoricons/mcp)

## Overview

Agents that generate icons inline often produce inconsistent SVG, unstable identifiers, and incorrect licensing across sessions. FreeVectorIcons stores approved assets in versioned collections with stable IDs and metadata.

This server exposes that collection to MCP clients. Agents search and retrieve canonical assets instead of regenerating SVG from scratch, and write designs back into the collection for review. Uploaded assets are versioned, so agents can iterate freely without losing prior work. The server runs over stdio and calls the FreeVectorIcons HTTP API. Responses are metadata-first JSON; file bytes are fetched only when a tool requests inline content or a download URL.

## Requirements

- Node.js 20 or later
- A FreeVectorIcons account
- A collection-scoped MCP token

## Setup

1. Open a collection at [freevectoricons.com](https://freevectoricons.com).
2. Go to **Integrations** → **Setup MCP**.
3. Create a token and copy the collection ID and secret.

Add the server to your MCP client configuration (for example `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "freevectoricons": {
      "command": "npx",
      "args": ["-y", "@freevectoricons/mcp"],
      "env": {
        "FVI_API_URL": "https://freevectoricons.com/api",
        "FVI_COLLECTION_ID": "<collection-id>",
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
| `FVI_TOKEN` | yes | — | Collection-scoped MCP token |
| `FVI_COLLECTION_ID` | yes | — | Collection ID |
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

## Tools

### Read (always available)

| Tool | Description |
|------|-------------|
| `get_design_collection_context` | Collection metadata, strategy brief, asset summary |
| `list_design_collection_assets` | All assets (metadata only) |
| `search_design_collection_assets` | Search by name, tag, category, or style |
| `get_design_asset` | One asset by ID |
| `get_design_asset_content` | Inline UTF-8 for catalog SVGs, uploaded SVGs, Markdown |
| `get_design_asset_download_url` | Short-lived URL for PNG, PDF, and other binaries |

### Write (enabled by default)

| Tool | Description |
|------|-------------|
| `create_design_asset_upload` | Create asset record and signed upload target |
| `park_design_asset` | Upload inline text or base64 into the collection |
| `create_design_asset_version` | Upload a new version of an existing asset (prior versions retained) |

Uploaded assets keep version history in FreeVectorIcons. Agents should prefer `create_design_asset_version` when refining an existing design, and `park_design_asset` for new files. Agents should use metadata and download URLs for images and PDFs.

Optional write metadata: `drlProjectId`, `drlAssetType`, `documentType`, `tags`.

## Limitations

- **Collection-scoped.** One token grants access to one collection, not the global icon catalog.
- **Catalog quality.** Catalog SVGs are AI-generated and refined on a schedule; verify assets before production use.
- **No design review.** The server moves files and metadata; it does not evaluate brand fit.

## Development

For local API development against a running FVI API server:

```bash
FVI_API_URL=http://localhost:5001/api \
FVI_COLLECTION_ID=<collection-id> \
FVI_TOKEN=<collection-token> \
node dist/mcp-server.mjs
```

```bash
npm install
npm run build
node dist/mcp-server.mjs
```

To run from a local checkout:

```json
"args": ["-y", "file:/absolute/path/to/fvi-mcp"]
```

Build first (`npm run build`). The bundled entry is `dist/mcp-server.mjs`.

## Related

- [freevectoricons.com/mcp](https://freevectoricons.com/mcp) — product documentation
- [ai-icon-generator](https://github.com/FreeVectorIcons/ai-icon-generator) — open pipeline for catalog icons

## License

MIT — applies to this MCP server software only. See [LICENSE](./LICENSE).

Icon usage is governed separately by the [FreeVectorIcons Community License](https://freevectoricons.com/license). Attribution may be required depending on your plan and how icons are used.
