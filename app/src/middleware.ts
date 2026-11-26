import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server';
import { sequence } from 'astro:middleware';
import { handleMcpHttp, isProductMcpPath } from '@/lib/mcp/http';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/settings(.*)']);

const clerk = clerkMiddleware((auth, context) => {
    const { redirectToSignIn, userId } = auth();
    if (!userId && isProtectedRoute(context.request)) {
        return redirectToSignIn({
            returnBackUrl: context.request.url,
        });
    }
}, {
    publishableKey: import.meta.env.CLERK_PUBLISHABLE_KEY,
    secretKey: import.meta.env.CLERK_SECRET_KEY,
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
});

// MCP clients send a Clerk OAuth access token, not a browser session. Handle
// those paths before Clerk's page middleware so it does not redirect them to
// /sign-in or verify the bearer token a second time.
const mcpMiddleware = async (context: Parameters<typeof clerk>[0], next: Parameters<typeof clerk>[1]) => {
    const pathname = new URL(context.request.url).pathname;
    if (!isProductMcpPath(pathname)) return next();
    return handleMcpHttp(context.request, context.locals.runtime?.env ?? {});
};

export const onRequest = sequence(mcpMiddleware, clerk);
