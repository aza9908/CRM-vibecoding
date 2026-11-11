import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for
  // - API routes
  // - Next internals (_next, _vercel)
  // - static files (anything with a dot, e.g. favicon.ico)
  // `/` is listed explicitly: under a basePath (e.g. /lms) the bare root
  // `/lms` does not match the catch-all below, so the default locale would 404.
  matcher: ['/', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
