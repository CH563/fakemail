/**
 * Self-contained instructions a signed-in user can paste to an AI agent so it
 * connects to this deployment's Fake Mail MCP. `mcpUrl` is the resolved
 * resource URL (production default or `MCP_RESOURCE_URL`).
 */
export function mcpAgentPrompt(mcpUrl: string): string {
    return [
        'Connect to my Fake Mail MCP server and use it to read the temporary mail for my signed-in account.',
        '',
        `MCP URL: ${mcpUrl}`,
        'Transport: Streamable HTTP. Send MCP JSON-RPC messages with POST. This is Fake Mail\'s own server at that URL, not Clerk\'s dashboard MCP.',
        `Auth: Clerk OAuth. If the server returns 401, follow the WWW-Authenticate Bearer challenge and its protected-resource metadata. The token audience (resource) is ${mcpUrl} and the scope is profile. Open Clerk so I can sign in and approve access, then retry with the bearer token. Do not use a browser session cookie.`,
        '',
        'Call these read-only tools in order:',
        '1. list_mailboxes with {} to list my mailboxes (id, email_address, alias, created_at).',
        '2. list_messages with { "id": <mailbox id from list_mailboxes> } to list messages without bodies (message_id, subject, sender, senderName, cc, received_at, is_read).',
        '3. get_message with { "message_id": "<message_id from list_messages>" } to read one message. The body is in content. This does not mark the message read.',
        '',
        'Stay inside that signed-in mailbox. Do not create, delete, remark, or mark mail. Anonymous 2-hour addresses are not available through this MCP.',
    ].join('\n');
}
