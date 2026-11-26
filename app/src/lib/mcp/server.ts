import { isClerkAuthInfo } from '@clerk/mcp-tools/hono';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getMessage, isMailError, listMailboxes, listMessages, type MailDb } from './mail';

const mailboxSchema = z.object({
    id: z.number().int(),
    email_address: z.string(),
    alias: z.string(),
    created_at: z.string(),
});

const summarySchema = z.object({
    message_id: z.string(),
    subject: z.string(),
    sender: z.string(),
    senderName: z.string(),
    cc: z.string(),
    received_at: z.string(),
    is_read: z.number().int(),
});

const messageSchema = summarySchema.extend({
    content: z.string().describe('Message body. Plain text when the message has one, otherwise HTML. Same field as GET /api/getMails.'),
});

type ToolContext = {
    http?: {
        authInfo?: Parameters<typeof isClerkAuthInfo>[0];
    };
};

function toolError(message: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text: message }],
    };
}

function toolJson(data: Record<string, unknown>): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
    };
}

function userIdFrom(ctx: ToolContext): string | undefined {
    const authInfo = ctx.http?.authInfo;
    if (!isClerkAuthInfo(authInfo)) return undefined;
    return authInfo.extra.userId;
}

/**
 * Stateless MCP server for one request. Tools only read the signed-in user's D1 mail.
 */
export function createMailMcpServer(db: MailDb): McpServer {
    const server = new McpServer(
        { name: 'fakemail', version: '1.0.0' },
        {
            instructions:
                'Fake Mail MCP for the signed-in user at mail.fakeact.fun. Call list_mailboxes, then list_messages with a mailbox id, then get_message with a message_id to read the body. Tools only read that user\'s logged-in mailboxes. They do not create, delete, remark, or mark mail, and they do not read anonymous 2-hour addresses.',
        },
    );

    server.registerTool(
        'list_mailboxes',
        {
            title: 'List mailboxes',
            description:
                'Lists the signed-in user\'s temporary email addresses. Each mailbox has id, email_address, alias, and created_at.',
            inputSchema: z.object({}),
            outputSchema: z.object({ mailboxes: z.array(mailboxSchema) }),
        },
        async (_args, ctx) => {
            const userId = userIdFrom(ctx);
            if (!userId) return toolError('Sign in with Clerk to read your mailboxes.');
            const result = await listMailboxes(db, userId);
            if (isMailError(result)) return toolError(result.error);
            return toolJson(result);
        },
    );

    server.registerTool(
        'list_messages',
        {
            title: 'List messages',
            description:
                'Lists messages in one of the signed-in user\'s mailboxes, newest first, without bodies. Use the returned message_id with get_message to read a body.',
            inputSchema: z.object({
                id: z.number().int().positive().describe('Mailbox id from list_mailboxes.'),
            }),
            outputSchema: z.object({
                mailbox_id: z.number().int(),
                messages: z.array(summarySchema),
            }),
        },
        async ({ id }, ctx) => {
            const userId = userIdFrom(ctx);
            if (!userId) return toolError('Sign in with Clerk to read your mailboxes.');
            const result = await listMessages(db, userId, id);
            if (isMailError(result)) return toolError(result.error);
            return toolJson(result);
        },
    );

    server.registerTool(
        'get_message',
        {
            title: 'Get message',
            description:
                'Returns one message owned by the signed-in user, including the body in content. Does not change read status.',
            inputSchema: z.object({
                message_id: z.string().min(1).max(2000).describe('message_id from list_messages.'),
            }),
            outputSchema: z.object({ message: messageSchema }),
        },
        async ({ message_id }, ctx) => {
            const userId = userIdFrom(ctx);
            if (!userId) return toolError('Sign in with Clerk to read your mailboxes.');
            const result = await getMessage(db, userId, message_id);
            if (isMailError(result)) return toolError(result.error);
            return toolJson(result);
        },
    );

    return server;
}
