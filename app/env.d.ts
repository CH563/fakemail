/// <reference types="astro/client" />

type KVNamespace = import('@cloudflare/workers-types').KVNamespace;
type D1Database = import('@cloudflare/workers-types').D1Database;
type ENV = {
    POST_DB: KVNamespace;
    MAIL_DB: D1Database;
    DKIM_PRIVATE_KEY: string;
    PUBLIC_TURNSTILE_SITE_KEY: string;
    SECRET_KEY: string;
    PUBLIC_CLERK_PUBLISHABLE_KEY: string;
    CLERK_SECRET_KEY: string;
    PUBLIC_CLERK_SIGN_IN_URL: string;
    PUBLIC_CLERK_SIGN_UP_URL: string;
    /** Optional override of the public MCP resource URL. Defaults to https://mail.fakeact.fun/mcp. */
    MCP_RESOURCE_URL?: string;
};

// use a default runtime configuration (advanced mode).
type Runtime = import('@astrojs/cloudflare').Runtime<ENV>;
declare namespace App {
    interface Locals extends Runtime {}
}


interface ImportMetaEnv {
    readonly SECRET_KEY: string;
    readonly PUBLIC_TURNSTILE_SITE_KEY: string;
    readonly PUBLIC_CLERK_PUBLISHABLE_KEY: string;
    readonly CLERK_SECRET_KEY: string;
    readonly PUBLIC_CLERK_SIGN_IN_URL: string;
    readonly PUBLIC_CLERK_SIGN_UP_URL: string;
    // 更多环境变量…
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}