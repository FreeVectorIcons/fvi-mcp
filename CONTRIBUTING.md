# Contributing to @freevectoricons/mcp

Maintainer notes for building, testing and releasing the package. Usage docs are in the [README](./README.md).

## Development

For local API development against a running FVI API server:

```bash
FVI_API_URL=http://localhost:5001/api \
FVI_TOKEN=<collection-token> \
node dist/mcp-server.mjs
```

```bash
npm install
npm test
npm run build
npm run smoke
npm run contract
node dist/mcp-server.mjs
```

Tool definitions live in `src/tools/definitions.ts` and talk to the API through the `FviApiClient` interface, so the hosted MCP endpoint can register the same tools. `src/mcp-server.ts` is the stdio host. `npm run contract` lists tools from the built server against a local fake API and compares names, schemas and flag gating with `scripts/tools-contract.json`. If a tool change is intended, rebuild and run `node ./scripts/contract.mjs --update`.

Old tool names from before 0.3.0-beta.3 live in `src/tools/legacy-names.ts`. They are accepted on call but never listed; do not add new entries there for new tools.

## Host files

`distribution.json` is the single source for install metadata. `npm run hosts` writes `server.json` (MCP Registry), `.cursor-plugin/plugin.json` and `mcp.json` (Cursor), `.antigravity-plugin/plugin.json` and `mcp_config.json` (Antigravity), `gemini-extension.json` and `GEMINI.md` (Gemini CLI), and `mcpName` in `package.json`. Versions come from `package.json`, and every host config pins that npm version. Do not edit the generated files by hand; `npm run hosts:check` fails in CI when they drift. Agent guidance lives in `skills/fvi-design-collection/SKILL.md`, which Cursor, Antigravity and Gemini CLI all load.

```bash
npm run hosts          # regenerate after changing distribution.json or the version
npm run pack-check     # pack, install into an empty directory, confirm every contract tool loads
npm run compat:gemini  # report schema keywords outside the Gemini function-declaration subset
```

To run from a local checkout:

```json
"args": ["-y", "file:/absolute/path/to/fvi-mcp"]
```

Build first (`npm run build`). The bundled entry is `dist/mcp-server.mjs`.

## Packaging

Runtime libraries (`@modelcontextprotocol/sdk`, `zod`) are **build-time only**. esbuild inlines them into `dist/mcp-server.mjs`, and published `dependencies` stays empty so `npx` does not install a second unused tree. Add new libraries as `devDependencies`, rebuild, and run `npm run smoke` before publish.

Maintainers still scan build inputs:

```bash
npm run audit:consumer    # install graph consumers see (must stay clean at moderate+)
npm run audit:maintainer  # includes devDependencies (high+)
```

After bumping a build dependency, rebuild and republish so `dist/` picks up the fix. See [Keeping @freevectoricons/mcp vulnerability-free](https://freevectoricons.com/blog/mcp-supply-chain-hardening).

## Publishing (CD only)

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
