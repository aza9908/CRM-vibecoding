import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names, resolving conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Sub-path the app is served under (e.g. `/lms` for https://airl.kz/lms/…).
 * Inlined at build time from NEXT_PUBLIC_BASE_PATH; empty when served at `/`.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(
  /\/+$/,
  '',
);

/**
 * Prefix a root-relative asset path (`/workbook/x.png`) with the base path.
 * Next's <Link>/router do this automatically; plain <img src> does not.
 * Absolute URLs, data/blob URLs and already-prefixed paths pass through.
 */
export function withBasePath(src: string): string;
export function withBasePath(src: string | null | undefined): string | undefined;
export function withBasePath(src: string | null | undefined): string | undefined {
  if (!src) return src ?? undefined;
  if (!BASE_PATH || !src.startsWith('/') || src.startsWith('//')) return src;
  if (src === BASE_PATH || src.startsWith(`${BASE_PATH}/`)) return src;
  return `${BASE_PATH}${src}`;
}
