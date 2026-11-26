/**
 * Self-contained instructions a signed-in user can paste to an AI agent so it
 * connects to this deployment's Fake Mail MCP. `mcpUrl` is the resolved
 * resource URL (production default or `MCP_RESOURCE_URL`).
 */
export function mcpAgentPrompt(mcpUrl: string): string {
    return `Use the Fake Mail MCP at ${mcpUrl} (Streamable HTTP) to create or delete mailboxes, list my mailboxes, and read message bodies.`;
}
