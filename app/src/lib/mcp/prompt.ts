/**
 * Self-contained instructions a signed-in user can paste to an AI agent so it
 * connects to this deployment's Fake Mail MCP. `mcpUrl` is the resolved
 * resource URL (production default or `MCP_RESOURCE_URL`).
 */
export function mcpAgentPrompt(mcpUrl: string): string {
    return `Connect to Fake Mail MCP at ${mcpUrl} (Streamable HTTP). Sign in with Clerk OAuth when prompted (scope: profile), then list my mailboxes and read message bodies. Read-only: do not create, delete, or change mail.`;
}
