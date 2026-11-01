import {extname} from 'node:path';

// OIDC start/callback are browser document navigations, not SPA routes.
// Leave API documents to the proxy even when Accept includes text/html.
export function isSPADocument(method,accept,pathname) {
  return method==='GET' && !!accept?.includes('text/html') && !extname(pathname)
    && pathname!=='/api' && !pathname.startsWith('/api/') && pathname!=='/health';
}
