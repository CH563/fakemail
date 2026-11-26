import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mcpAgentPrompt } from './prompt.ts';

describe('MCP agent prompt', () => {
    it('tells the agent to connect, sign in when prompted, and read mail', () => {
        const url = 'http://localhost:4321/mcp';
        const prompt = mcpAgentPrompt(url);
        assert.equal(
            prompt,
            `Connect to Fake Mail MCP at ${url} (Streamable HTTP). Sign in with Clerk OAuth when prompted (scope: profile), then list my mailboxes and read message bodies. Read-only: do not create, delete, or change mail.`,
        );
        assert.equal(prompt.split(url).length - 1, 1);
        assert.doesNotMatch(
            prompt,
            /WWW-Authenticate|protected-resource|JSON-RPC|cookie|Open Clerk|dashboard MCP/i,
        );
    });
});
