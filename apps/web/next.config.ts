import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Serve under a sub-path, e.g. NEXT_PUBLIC_BASE_PATH=/lms → https://airl.kz/lms/en
// (the airl.kz landing proxies /lms/* here). Unset = served at the root.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  transpilePackages: ['@lms/shared'],
  // Lean, self-contained server bundle for Docker (VPS deploy).
  output: 'standalone',
};

export default withNextIntl(nextConfig);
