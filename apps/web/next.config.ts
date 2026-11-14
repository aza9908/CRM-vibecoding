import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Serve under a sub-path, e.g. NEXT_PUBLIC_BASE_PATH=/lms → https://airl.kz/lms/en
// (the airl.kz landing proxies /lms/* here). Unset = served at the root.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(basePath
    ? {
        basePath,
        // Old links to the bare host (e.g. https://lms.magauin.kz/) keep
        // working: send them into the app under its base path.
        async redirects() {
          return [
            { source: '/', destination: basePath, basePath: false, permanent: false },
          ];
        },
      }
    : {}),
  async headers() {
    return [
      {
        // Other lesson files keep their names when they change: always ask
        // the server (a cheap 304 when nothing changed), never show a stale copy.
        source: '/workbook/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        // Lesson media named by content hash: a new version gets a new name,
        // so browsers may keep each file for good. Listed last so it wins.
        source: '/workbook/aitu/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  transpilePackages: ['@lms/shared'],
  // Lean, self-contained server bundle for Docker (VPS deploy).
  output: 'standalone',
};

export default withNextIntl(nextConfig);
