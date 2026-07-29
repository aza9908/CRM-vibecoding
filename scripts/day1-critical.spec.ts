/**
 * Critical smoke checks for the Day-1 LMS ship.
 *
 * Run with the official Playwright tooling (Claude Code plugin from
 * claude.com/plugins, or locally):
 *
 *   WEB_URL=https://lms.magauin.kz npx playwright test scripts/day1-critical.spec.ts
 *
 * Or paste the checklist from SHIP-GUIDE.md into Claude Code with the Playwright plugin.
 */
import { test, expect } from '@playwright/test';

const WEB = process.env.WEB_URL ?? 'https://lms.magauin.kz';
const API =
  process.env.API_URL ?? 'https://lms-ai--lms-ai-a2fd7.europe-west4.hosted.app';

test.describe('Day-1 LMS critical', () => {
  test('register form shows ФИО, company, occupation, email', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(`${WEB}/ru/register`);
    await expect(page.getByLabel(/ФИО|Full name|Толық/i)).toBeVisible();
    await expect(page.getByLabel(/компании|Company|Компания/i)).toBeVisible();
    await expect(page.getByLabel(/Должность|Occupation|Лауазым/i)).toBeVisible();
    await expect(page.getByLabel(/Email|email|Почта/i).first()).toBeVisible();
    expect(errors, `no 5xx on register: ${errors.join(', ')}`).toEqual([]);
  });

  test('slide assets are reachable', async ({ request }) => {
    for (const n of [1, 6, 42, 43]) {
      const path = `/workbook/slide-${String(n).padStart(2, '0')}.png`;
      const res = await request.get(`${WEB}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'] ?? '').toMatch(/image/);
    }
  });

  test('presign without auth is not a raw 500', async ({ request }) => {
    const res = await request.post(`${API}/uploads/presign`, {
      data: { filename: 'a.png', contentType: 'image/png' },
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });

  test('invalid register payload is not a 500', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: { email: 'bad', password: 'x' },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
