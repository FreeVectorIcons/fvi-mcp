# FreeVectorIcons

This extension connects Gemini CLI to one FreeVectorIcons design collection through the `freevectoricons` MCP server.

- Use its tools when the user needs icons, logos, brand assets or the project's design rules, or wants a deliverable saved to their collection. Do not use them for unrelated tasks.
- Call `get_collection_context` first and follow the collection's strategy brief and DESIGN.md before choosing or generating assets.
- Prefer assets already in the user's collection over drawing new SVG.
- Say what you are about to save before calling a write tool such as `park_asset` or `create_asset_version`.
- Never print, echo or write `FVI_TOKEN` anywhere. On `TOKEN_MISSING`, `TOKEN_MALFORMED` or `TOKEN_INVALID`, ask the user to run `gemini extensions config freevectoricons` with a fresh token from Integrations → Setup MCP.

The `fvi-design-collection` skill in this extension has the full flow and error handling.
