# fvi-mcp

MCP server for [FreeVectorIcons](https://freevectoricons.com) design collections.

Connects Cursor, Claude Desktop, and other MCP clients to one FVI collection — icons, uploaded SVGs, strategy briefs, DESIGN.md, and related project files. Scoped to a single collection token.

npm: [`@freevectoricons/mcp`](https://www.npmjs.com/package/@freevectoricons/mcp)

## Why this exists

The usual agent workflow for icons is: prompt → inline SVG → paste into code. That breaks down quickly — inconsistent paths, missing `viewBox`, made-up attribution, different output on every retry.

FVI stores assets in a collection with stable ids, tags, and license fields. This server lets agents **search and fetch what's already approved** instead of generating new SVG from scratch.

It's a stdio MCP wrapper over the FVI HTTP API. Responses are metadata-first JSON; file bytes are fetched only when a tool asks for content or a download URL.

## Setup

You need a FreeVectorIcons account and an MCP token for a design collection.

1. Open a collection at [freevectoricons.com](https://freevectoricons.com)
2. **Integrations** → **Setup MCP**
3. Create a token; copy the collection ID and secret

Add to `.cursor/mcp.json` (or your client's MCP config):

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

Use `npx`, not `pnpm run`. Package managers print lifecycle text to stdout, which breaks MCP stdio transport.

See [`mcp.json.example`](./mcp.json.example) for a copy-paste template.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FVI_TOKEN` | yes | — | Collection-scoped MCP token |
| `FVI_COLLECTION_ID` | yes | — | Collection id |
| `FVI_API_URL` | no | `http://localhost:5001/api` | API base URL (include `/api`) |

For production: `FVI_API_URL=https://freevectoricons.com/api`

## Tools

### Read

| Tool | What it does |
|------|----------------|
| `get_design_collection_context` | Collection metadata, strategy brief, asset summary |
| `list_design_collection_assets` | All assets (metadata only) |
| `search_design_collection_assets` | Search by name, tag, category, or style |
| `get_design_asset` | One asset by id |
| `get_design_asset_content` | Inline UTF-8 for catalog SVGs, uploaded SVGs, Markdown |
| `get_design_asset_download_url` | Short-lived URL for PNG, PDF, and other binaries |

### Write

| Tool | What it does |
|------|----------------|
| `create_design_asset_upload` | Create asset record + signed upload target |
| `park_design_asset` | Upload inline text or base64 into the collection |
| `create_design_asset_version` | Upload a new version of an existing asset |

Binary files are not embedded in MCP responses. Agents should use metadata + download URLs for images and PDFs.

Optional write metadata: `drlProjectId`, `drlAssetType`, `documentType`, `tags`.

## Development

```bash
npm install
npm run build
node dist/mcp-server.mjs
```

To run from a local checkout in Cursor:

```json
"args": ["-y", "file:/absolute/path/to/fvi-mcp"]
```

Build first (`npm run build`). The bundled entry is `dist/mcp-server.mjs`.

## What this is not

- **Not a global icon search API.** One token, one collection.
- **Not a guarantee of pixel-perfect icons.** Catalog SVGs are AI-generated and refined on a schedule; check assets before production use.
- **Not a replacement for your design review.** It moves files and metadata; it doesn't judge brand fit.

## Related

- [freevectoricons.com/mcp](https://freevectoricons.com/mcp) — product docs
- [ai-icon-generator](https://github.com/FreeVectorIcons/ai-icon-generator) — open pipeline that produces catalog icons

## License

MIT — see [LICENSE](./LICENSE).
