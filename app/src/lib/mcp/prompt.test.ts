import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mcpAgentPrompt } from './prompt.ts';

describe('MCP agent prompt', () => {
    it('includes the resolved URL, transport, auth, tools, and the read-only boundary', () => {
        const url = 'http://localhost:4321/mcp';
        const prompt = mcpAgentPrompt(url);
        assert.match(prompt, new RegExp(url.replace(/[.]/g, '\\.'), 'g'));
        assert.equal(prompt.split(url).length - 1, 2);
        assert.match(prompt, /Streamable HTTP/);
        assert.match(prompt, /Clerk OAuth/);
        assert.match(prompt, /scope is profile/);
        assert.match(prompt, /list_mailboxes/);
        assert.match(prompt, /list_messages/);
        assert.match(prompt, /get_message/);
        assert.match(prompt, /Anonymous 2-hour addresses are not available/);
        assert.match(prompt, /read-only/);
        assert.doesNotMatch(prompt, /mcp\.clerk\.com/);
    });
});
