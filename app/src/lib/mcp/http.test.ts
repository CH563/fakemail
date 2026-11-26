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
        assert.match(challenge, /Bearer/i);
        assert.match(challenge, /resource_metadata=/);
        assert.match(challenge, /oauth-protected-resource\/mcp/);
        const body = await response.text();
        assert.doesNotMatch(body, /example\.test|Fake sample|body_text/);
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
