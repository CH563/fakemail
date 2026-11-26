/** Public Streamable HTTP endpoint for this product's logged-in mail MCP. */
export const PRODUCTION_MCP_RESOURCE_URL = 'https://mail.fakeact.fun/mcp';

/**
 * Audience and protected-resource URL clients must use.
 * `MCP_RESOURCE_URL` overrides the production default (local `wrangler dev` / Astro).
 * Only http(s) URLs are accepted, and plain http is limited to loopback.
 */
export function resolveMcpResourceUrl(env?: { MCP_RESOURCE_URL?: string } | null): string {
    const configured = normalizeResourceUrl(env?.MCP_RESOURCE_URL);
    return configured ?? PRODUCTION_MCP_RESOURCE_URL;
}

export function normalizeResourceUrl(value: string | undefined | null): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return undefined;
    }
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'http:') {
        if (!loopback) return undefined;
    } else if (parsed.protocol !== 'https:') {
        return undefined;
    }
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
}
