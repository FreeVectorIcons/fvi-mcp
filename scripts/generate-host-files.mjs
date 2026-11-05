#!/usr/bin/env node
/**
 * Writes every host's install metadata from distribution.json and package.json:
 * the MCP Registry server.json, the Cursor and Antigravity plugin manifests and
 * MCP configs, the Gemini CLI extension manifest and GEMINI.md, and mcpName in
 * package.json. Pass --check to fail instead of writing when a file is stale.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");

const readJson = (file) => JSON.parse(readFileSync(join(packageRoot, file), "utf8"));
const dist = readJson("distribution.json");
const pkg = readJson("package.json");

const REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const ANTIGRAVITY_SCHEMA = "https://antigravity.google/schemas/v1/plugin.json";

function validate() {
  const problems = [];
  if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(dist.registryName)) problems.push("registryName is not a valid registry server name");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dist.pluginName)) problems.push("pluginName must be kebab-case");
  if (dist.summary.length > 100) problems.push(`summary is ${dist.summary.length} characters; the registry allows 100`);
  if (dist.suggestedPrompts.length > 3) problems.push("Antigravity allows at most 3 suggestedPrompts");
  if (!dist.env.some((v) => v.name === "FVI_TOKEN" && v.required && v.secret)) problems.push("FVI_TOKEN must be declared required and secret");
  if (!existsSync(join(packageRoot, dist.logo))) problems.push(`logo ${dist.logo} is missing`);
  if (!existsSync(join(packageRoot, "skills", dist.skill, "SKILL.md"))) problems.push(`skills/${dist.skill}/SKILL.md is missing`);
  if (!dist.hostedMcpUrl || !/^https:\/\/\S+$/.test(dist.hostedMcpUrl)) problems.push("hostedMcpUrl must be an https URL");
  if (problems.length > 0) {
    console.error(`distribution.json is invalid:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const packageSpec = `${pkg.name}@${pkg.version}`;
const token = dist.env.find((v) => v.name === "FVI_TOKEN");

function cursorPlugin() {
  return {
    name: dist.pluginName,
    version: pkg.version,
    description: dist.description,
    author: { name: dist.author.name, email: dist.author.email },
    homepage: dist.homepage,
    repository: dist.repository,
    license: dist.license,
    keywords: dist.keywords,
    logo: dist.logo,
    variables: {
      type: "object",
      properties: Object.fromEntries(
        dist.env.map((v) => [
          v.name,
          {
            type: "string",
            title: v.title,
            description: v.description,
            ...(v.choices ? { enum: v.choices } : {}),
            ...(v.default !== undefined ? { default: v.default } : {}),
          },
        ]),
      ),
      required: dist.env.filter((v) => v.required).map((v) => v.name),
    },
  };
}

function cursorMcp() {
  return {
    mcpServers: {
      [dist.serverKey]: {
        command: "npx",
        args: ["-y", packageSpec],
        env: Object.fromEntries(dist.env.map((v) => [v.name, `\${${v.name}}`])),
      },
    },
  };
}

// Gemini CLI still uses the local stdio package and prompts only for the token.
// Antigravity uses the hosted remote (see antigravityMcp) and signs in with OAuth.
function antigravityPlugin() {
  return {
    $schema: ANTIGRAVITY_SCHEMA,
    name: dist.pluginName,
    displayName: dist.displayName,
    version: pkg.version,
    description: dist.description,
    logo: dist.logo,
    suggestedPrompts: dist.suggestedPrompts,
    author: dist.author,
    homepage: dist.homepage,
    repository: dist.repository,
    license: dist.license,
    keywords: dist.keywords,
  };
}

function antigravityMcp() {
  // Hosted Streamable HTTP. Antigravity negotiates OAuth (DCR) on connect;
  // no collection token is prompted for the plugin install.
  return {
    mcpServers: {
      [dist.serverKey]: {
        serverUrl: dist.hostedMcpUrl,
      },
    },
  };
}

function geminiExtension() {
  return {
    name: dist.pluginName,
    version: pkg.version,
    description: dist.description,
    mcpServers: {
      [dist.serverKey]: {
        command: "npx",
        args: ["-y", packageSpec],
        env: { [token.name]: `\${${token.name}}` },
      },
    },
    contextFileName: "GEMINI.md",
    settings: [
      { name: token.title, description: token.description, envVar: token.name, sensitive: true },
    ],
  };
}

function geminiContext() {
  return `# ${dist.displayName}

This extension connects Gemini CLI to one ${dist.displayName} design collection through the \`${dist.serverKey}\` MCP server.

- Use its tools when the user needs icons, logos, brand assets or the project's design rules, or wants a deliverable saved to their collection. Do not use them for unrelated tasks.
- Call \`get_design_collection_context\` first and follow the collection's strategy brief and DESIGN.md before choosing or generating assets.
- Prefer assets already in the user's collection over drawing new SVG.
- If tools from FreeVectorIcons are missing, ask the user to enable the extension / MCP server — do not say FreeVectorIcons has no integration.
- Say what you are about to save before calling a write tool such as \`park_design_asset\` or \`create_design_asset_version\`.
- Never print, echo or write \`${token.name}\` anywhere. On \`TOKEN_MISSING\`, \`TOKEN_MALFORMED\` or \`TOKEN_INVALID\`, ask the user to run \`gemini extensions config ${dist.pluginName}\` with a fresh token from Integrations → Setup MCP.

The \`${dist.skill}\` skill in this extension has the full flow and error handling.
`;
}

function registryServer() {
  return {
    $schema: REGISTRY_SCHEMA,
    name: dist.registryName,
    title: dist.displayName,
    description: dist.summary,
    version: pkg.version,
    websiteUrl: dist.homepage,
    repository: { url: dist.repository, source: "github" },
    icons: [{ src: dist.logoUrl, mimeType: "image/svg+xml" }],
    packages: [
      {
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: "stdio" },
        environmentVariables: dist.env.map((v) => ({
          name: v.name,
          description: v.description,
          format: "string",
          isRequired: Boolean(v.required),
          isSecret: Boolean(v.secret),
          ...(v.default !== undefined ? { default: v.default } : {}),
          ...(v.choices ? { choices: v.choices } : {}),
        })),
      },
    ],
    remotes: [
      {
        type: "streamable-http",
        url: dist.hostedMcpUrl,
      },
    ],
  };
}

function packageWithMcpName() {
  const out = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (key === "mcpName") continue;
    out[key] = value;
    if (key === "name") out.mcpName = dist.registryName;
  }
  return out;
}

validate();

const outputs = {
  "server.json": json(registryServer()),
  ".cursor-plugin/plugin.json": json(cursorPlugin()),
  "mcp.json": json(cursorMcp()),
  ".antigravity-plugin/plugin.json": json(antigravityPlugin()),
  "mcp_config.json": json(antigravityMcp()),
  "gemini-extension.json": json(geminiExtension()),
  "GEMINI.md": geminiContext(),
  "package.json": json(packageWithMcpName()),
};

const stale = [];
for (const [file, contents] of Object.entries(outputs)) {
  const path = join(packageRoot, file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === contents) continue;
  stale.push(file);
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

if (check && stale.length > 0) {
  console.error(`host files are stale: ${stale.join(", ")}`);
  console.error("Run: npm run hosts");
  process.exit(1);
}
console.log(check ? "host files ok" : `host files written${stale.length ? `: ${stale.join(", ")}` : " (no changes)"}`);
