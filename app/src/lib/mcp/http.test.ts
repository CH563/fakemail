import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRODUCTION_MCP_RESOURCE_URL, normalizeResourceUrl, resolveMcpResourceUrl } from './resource.ts';
import { AUTHORIZATION_SERVER_PATH, PROTECTED_RESOURCE_PATH, handleMcpHttp, isProductMcpPath } from './http.ts';
import type { MailDb } from './mail.ts';

const db: MailDb = {
    prepare() {
        return {
            bind() {
                return { async run() { return { results: [] }; } };
            },
        };
    },
};

const env = {
    MAIL_DB: db,
    CLERK_SECRET_KEY: 'sk_test_fake_secret_for_unit_tests',
    PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_ZmFrZS1jbGVyay5leGFtcGxlLnRlc3Qk',
};

function mcpRequest(method: string, body?: unknown, path = '/mcp') {
    return new Request(`https://mail.fakeact.fun${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function readRpc(response: Response): Promise<unknown> {
    const text = await response.text();
    const dataLines = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6));
    const payload = dataLines.length ? dataLines[dataLines.length - 1] : text;
    return JSON.parse(payload);
}

describe('MCP resource URL', () => {
    it('defaults to the public product endpoint', () => {
        assert.equal(resolveMcpResourceUrl(undefined), PRODUCTION_MCP_RESOURCE_URL);
        assert.equal(resolveMcpResourceUrl({}), PRODUCTION_MCP_RESOURCE_URL);
    });

    it('accepts a loopback override and rejects non-http URLs', () => {
        assert.equal(resolveMcpResourceUrl({ MCP_RESOURCE_URL: 'http://localhost:4321/mcp/' }), 'http://localhost:4321/mcp');
        assert.equal(normalizeResourceUrl('javascript:alert(1)'), undefined);
        assert.equal(resolveMcpResourceUrl({ MCP_RESOURCE_URL: 'http://mail.fakeact.fun/mcp' }), PRODUCTION_MCP_RESOURCE_URL);
    });
});

describe('product MCP HTTP', () => {
    it('recognizes only the product MCP paths', () => {
        assert.equal(isProductMcpPath('/mcp'), true);
        assert.equal(isProductMcpPath('/mcp/'), true);
        assert.equal(isProductMcpPath(PROTECTED_RESOURCE_PATH), true);
        assert.equal(isProductMcpPath(AUTHORIZATION_SERVER_PATH), true);
        assert.equal(isProductMcpPath('/api/get'), false);
        assert.equal(isProductMcpPath('/api/getMails'), false);
    });

    it('lists the three read tools without a token', async () => {
        const response = await handleMcpHttp(mcpRequest('POST', {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
        }), env);
        assert.equal(response.status, 200);
        const body = await readRpc(response) as { result?: { tools?: { name: string }[] } };
        const names = body.result?.tools?.map((tool) => tool.name).sort();
        assert.deepEqual(names, ['get_message', 'list_mailboxes', 'list_messages']);
    });

    it('challenges a tool call that has no Clerk token', async () => {
        const response = await handleMcpHttp(mcpRequest('POST', {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'list_mailboxes', arguments: {} },
        }), env);
        assert.equal(response.status, 401);
        const challenge = response.headers.get('www-authenticate') ?? '';
        assert.equal(
            challenge,
            'Bearer resource_metadata="https://mail.fakeact.fun/.well-known/oauth-protected-resource/mcp", scope="profile"',
        );
        const body = await response.text();
        assert.doesNotMatch(body, /example\.test|Fake sample|body_text/);
    });

    it('challenges an unauthenticated GET with the same Bearer header as tools/call', async () => {
        const getResponse = await handleMcpHttp(mcpRequest('GET'), env);
        const postResponse = await handleMcpHttp(mcpRequest('POST', {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'list_mailboxes', arguments: {} },
        }), env);
        assert.equal(getResponse.status, 401);
        assert.equal(postResponse.status, 401);
        const challenge = getResponse.headers.get('www-authenticate');
        assert.equal(challenge, postResponse.headers.get('www-authenticate'));
        assert.equal(
            challenge,
            'Bearer resource_metadata="https://mail.fakeact.fun/.well-known/oauth-protected-resource/mcp", scope="profile"',
        );
        assert.equal(getResponse.headers.get('allow'), null);
        const body = await getResponse.json() as { error?: string };
        assert.equal(body.error, 'Unauthorized');
    });

    it('uses MCP_RESOURCE_URL in the unauthenticated GET challenge', async () => {
        const localEnv = { ...env, MCP_RESOURCE_URL: 'http://localhost:4321/mcp/' };
        const getResponse = await handleMcpHttp(mcpRequest('GET'), localEnv);
        const postResponse = await handleMcpHttp(mcpRequest('POST', {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'list_messages', arguments: { id: 1 } },
        }), localEnv);
        assert.equal(getResponse.status, 401);
        const challenge = getResponse.headers.get('www-authenticate');
        assert.equal(challenge, postResponse.headers.get('www-authenticate'));
        assert.equal(
            challenge,
            'Bearer resource_metadata="http://localhost:4321/.well-known/oauth-protected-resource/mcp", scope="profile"',
        );
    });

    it('sends a bearer GET through Clerk auth instead of the missing-token challenge', async () => {
        const response = await handleMcpHttp(new Request('https://mail.fakeact.fun/mcp', {
            method: 'GET',
            headers: {
                authorization: 'Bearer not-a-jwt',
                accept: 'application/json, text/event-stream',
            },
        }), env);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('allow'), null);
        assert.equal(
            response.headers.get('www-authenticate'),
            'Bearer resource_metadata="https://mail.fakeact.fun/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="profile"',
        );
    });

    it('leaves CORS preflight on /mcp open', async () => {
        const response = await handleMcpHttp(new Request('https://mail.fakeact.fun/mcp', {
            method: 'OPTIONS',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'GET',
            },
        }), env);
        assert.notEqual(response.status, 401);
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('www-authenticate'), null);
        const allowMethods = response.headers.get('access-control-allow-methods') ?? '';
        assert.match(allowMethods, /GET/);
        assert.match(allowMethods, /POST/);
        assert.match(allowMethods, /OPTIONS/);
    });

    it('publishes protected-resource metadata for the product endpoint', async () => {
        const response = await handleMcpHttp(mcpRequest('GET', undefined, PROTECTED_RESOURCE_PATH), env);
        assert.equal(response.status, 200);
        const body = await response.json() as {
            resource?: string;
            scopes_supported?: string[];
            authorization_servers?: string[];
        };
        assert.equal(body.resource, 'https://mail.fakeact.fun/mcp');
        assert.deepEqual(body.scopes_supported, ['profile']);
        assert.deepEqual(body.authorization_servers, ['https://fake-clerk.example.test']);
    });

    it('does not serve the anonymous KV mail routes', async () => {
        const response = await handleMcpHttp(mcpRequest('GET', undefined, '/api/get'), env);
        assert.equal(response.status, 404);
    });
});
