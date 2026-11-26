import { createClerkClient } from '@clerk/backend';
import { McpAuthError, fetchAuthorizationServerMetadata, generateProtectedResourceMetadata, mcpAuth, metadataCorsHeaders, streamableHttpHandler, type McpAuthOptions } from '@clerk/mcp-tools/hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MailDb } from './mail';
import { resolveMcpResourceUrl } from './resource';
import { createMailMcpServer } from './server';

export const MCP_PATH = '/mcp';
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/mcp';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';

const MCP_PATHS = new Set([MCP_PATH, PROTECTED_RESOURCE_PATH, AUTHORIZATION_SERVER_PATH]);

export type McpRuntimeEnv = {
    MAIL_DB?: MailDb;
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
    PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
    MCP_RESOURCE_URL?: string;
};

export function isProductMcpPath(pathname: string): boolean {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    return MCP_PATHS.has(path);
}

let cachedClerk: { secretKey: string; publishableKey: string; client: ReturnType<typeof createClerkClient> } | undefined;

function clerkClientFor(secretKey: string, publishableKey: string) {
    if (cachedClerk?.secretKey === secretKey && cachedClerk.publishableKey === publishableKey) {
        return cachedClerk.client;
    }
    const client = createClerkClient({ secretKey, publishableKey });
    cachedClerk = { secretKey, publishableKey, client };
    return client;
}

/**
 * This product's MCP server lists mailboxes and reads message bodies for the
 * signed-in user. It is not Clerk's dashboard MCP at mcp.clerk.com.
 *
 * Clerk OAuth access tokens are checked by `@clerk/mcp-tools` against
 * `resourceUrl`. Browser session cookies are not accepted.
 */
export function createMcpApp(env: McpRuntimeEnv) {
    const resourceUrl = resolveMcpResourceUrl(env);
    const publishableKey = env.CLERK_PUBLISHABLE_KEY || env.PUBLIC_CLERK_PUBLISHABLE_KEY || '';
    const secretKey = env.CLERK_SECRET_KEY || '';
    const mcpAuthOptions = {
        resourceUrl,
        requiredScopes: ['profile'],
        // Pass the client explicitly. Hono's env() reads worker bindings only on
        // workerd and process.env on Node, but Astro dev serves this same module
        // on Node with keys on the platform-proxy env object.
        clerkClient: () => clerkClientFor(secretKey, publishableKey),
    } satisfies McpAuthOptions;

    const app = new Hono();
    app.use('*', cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Mcp-Session-Id', 'Last-Event-ID'],
        exposeHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version', 'Mcp-Session-Id'],
    }));

    app.onError((err, c) => {
        if (err instanceof McpAuthError) {
            const cause = err.cause instanceof Error ? err.cause.message : undefined;
            console.error('MCP auth failed', err.reason, cause);
            const status = err.status === 429 ? 429 : 500;
            return c.json({ error: 'server_error' }, status);
        }
        console.error('MCP request failed', err instanceof Error ? err.message : 'unknown error');
        return c.json({ error: 'server_error' }, 500);
    });

    app.all(PROTECTED_RESOURCE_PATH, (c) => {
        if (c.req.method === 'OPTIONS') return c.body(null, 200, metadataCorsHeaders);
        return c.json(generateProtectedResourceMetadata({
            publishableKey,
            resourceUrl,
            properties: { scopes_supported: [...mcpAuthOptions.requiredScopes] },
        }), 200, {
            'cache-control': 'max-age=3600',
            ...metadataCorsHeaders,
        });
    });
    app.all(AUTHORIZATION_SERVER_PATH, async (c) => {
        if (c.req.method === 'OPTIONS') return c.body(null, 200, metadataCorsHeaders);
        try {
            const metadata = await fetchAuthorizationServerMetadata({ publishableKey });
            return c.json(metadata, 200, {
                'cache-control': 'max-age=3600',
                ...metadataCorsHeaders,
            });
        } catch (error) {
            console.error('MCP authorization server metadata failed', error instanceof Error ? error.message : 'unknown error');
            return c.json({ error: 'server_error' }, 502, metadataCorsHeaders);
        }
    });
    app.all(MCP_PATH, async (c, next) => {
        // mcpAuth returns 405 for an unauthenticated GET while the handshake is
        // public (the default). That response has no WWW-Authenticate header.
        // Clerk's MCP checker only sends this GET, so answer it with the same
        // 401 challenge as an unauthenticated tools/call. POST stays the
        // transport. A GET that already has Authorization continues to mcpAuth
        // and the streamable handler, which is the authenticated SSE path.
        if (c.req.method === 'GET' && !c.req.header('authorization')?.trim()) {
            return c.json({ error: 'Unauthorized' }, {
                status: 401,
                headers: {
                    'WWW-Authenticate': bearerChallenge(resourceUrl, mcpAuthOptions.requiredScopes),
                },
            });
        }
        await next();
    }, mcpAuth(mcpAuthOptions), streamableHttpHandler(
        () => createMailMcpServer(env.MAIL_DB ?? unavailableDb()),
        WebStandardStreamableHTTPServerTransport,
    ));

    return app;
}

export function handleMcpHttp(request: Request, env: McpRuntimeEnv): Response | Promise<Response> {
    const url = new URL(request.url);
    if (!isProductMcpPath(url.pathname)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (!env.MAIL_DB) {
        return new Response(JSON.stringify({ error: 'server_error' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
        });
    }
    const publishableKey = env.CLERK_PUBLISHABLE_KEY || env.PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey || !env.CLERK_SECRET_KEY) {
        return new Response(JSON.stringify({ error: 'server_error' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
        });
    }
    const bindings = {
        ...env,
        CLERK_PUBLISHABLE_KEY: publishableKey,
        CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
    };
    return createMcpApp(bindings).fetch(request, bindings);
}

/**
 * Bearer challenge `@clerk/mcp-tools` puts on a 401. `resource_metadata` is the
 * RFC 9728 URL derived from the same `resourceUrl` passed to `mcpAuth`
 * (`resolveMcpResourceUrl`, including `MCP_RESOURCE_URL`).
 */
function bearerChallenge(resourceUrl: string, scopes: readonly string[]): string {
    const params = [`resource_metadata=${quotedAuthParam(resourceMetadataUrlFor(resourceUrl))}`];
    if (scopes.length > 0) params.push(`scope=${quotedAuthParam(scopes.join(' '))}`);
    return `Bearer ${params.join(', ')}`;
}

function resourceMetadataUrlFor(resourceUrl: string): string {
    const { origin, pathname, search } = new URL(resourceUrl);
    return `${origin}/.well-known/oauth-protected-resource${pathname === '/' ? '' : pathname}${search}`;
}

function quotedAuthParam(value: string): string {
    return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function unavailableDb(): MailDb {
    return {
        prepare() {
            return {
                bind() {
                    return {
                        async run() {
                            throw new Error('MAIL_DB is not configured');
                        },
                    };
                },
            };
        },
    };
}
