import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mcpAgentPrompt } from './prompt.ts';

describe('MCP agent prompt', () => {
    it('tells the agent to use the MCP URL to list mailboxes and read bodies', () => {
        const url = 'http://localhost:4321/mcp';
        const prompt = mcpAgentPrompt(url);
        assert.equal(
            prompt,
            `Use the Fake Mail MCP at ${url} (Streamable HTTP) to list my mailboxes and read message bodies. Read-only: do not create, delete, or change mail.`,
        );
        assert.equal(prompt.split(url).length - 1, 1);
        assert.doesNotMatch(
            prompt,
            /sign in|log in|login|clerk|oauth|browser|approve|WWW-Authenticate|protected-resource|JSON-RPC|cookie|dashboard MCP/i,
        );
    });
});
