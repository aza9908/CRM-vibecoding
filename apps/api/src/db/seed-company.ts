/**
 * Create a company and its first promo code, and optionally its first admin.
 *
 * This is the platform-operator counterpart to `/admin/company`: signup now
 * requires a valid promo code, and the admin API only ever touches the
 * caller's own tenant, so bringing a brand-new company online has to happen
 * out of band. That is deliberate — it is the one operation that crosses
 * tenant boundaries, and it stays off the HTTP surface entirely.
 *
 * Usage (from the repo root, DATABASE_URL must be set):
 *   npm run seed:company --workspace=@lms/api -- --name "Acme" \
 *     [--code ACME2026] [--admin-email a@acme.kz] [--admin-password ...] \
 *     [--admin-name "Айгуль"] [--max-uses 50]
 *
 * Re-running with the same `--name` reuses the existing company rather than
 * creating a duplicate, so it is safe to call twice.
 */
try {
  require('dotenv').config();
} catch {
  /* env already provided */
}
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { PROMO_CODE_ALPHABET, PROMO_CODE_LENGTH } from '@lms/shared';
import { randomInt } from 'node:crypto';

import { schema, organizations, promoCodes, users } from './schema';

interface Args {
  name: string;
  code?: string;
  maxUses?: number;
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, 'true');
    }
  }
  const name = flags.get('name');
  if (!name || name === 'true') {
    throw new Error('--name "Company name" is required');
  }
  const maxUsesRaw = flags.get('max-uses');
  return {
    name,
    code: flags.get('code'),
    maxUses: maxUsesRaw ? Number(maxUsesRaw) : undefined,
    adminEmail: flags.get('admin-email'),
    adminPassword: flags.get('admin-password'),
    adminName: flags.get('admin-name'),
  };
}

function randomCode(length = PROMO_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PROMO_CODE_ALPHABET[randomInt(PROMO_CODE_ALPHABET.length)];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const [existingOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, args.name))
      .limit(1);

    const org =
      existingOrg ??
      (
        await db
          .insert(organizations)
          .values({ name: args.name })
          .returning()
      )[0];

    console.log(
      existingOrg
        ? `· company already existed: ${org.name} (${org.id})`
        : `✓ company created: ${org.name} (${org.id})`,
    );

    const code = (args.code ?? randomCode())
      .replace(/[\s-]/g, '')
      .toUpperCase();
    const [codeTaken] = await db
      .select({ id: promoCodes.id, organizationId: promoCodes.organizationId })
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);

    if (codeTaken && codeTaken.organizationId !== org.id) {
      throw new Error(`promo code ${code} already belongs to another company`);
    }
    if (!codeTaken) {
      await db.insert(promoCodes).values({
        organizationId: org.id,
        code,
        label: 'Создан скриптом seed:company',
        maxUses: args.maxUses ?? null,
      });
    }
    console.log(
      `✓ promo code: ${code}` +
        (args.maxUses ? ` (до ${args.maxUses} регистраций)` : ' (без лимита)'),
    );

    if (args.adminEmail) {
      const password = args.adminPassword ?? randomCode(14);
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, args.adminEmail))
        .limit(1);

      if (existingUser) {
        console.log(`· admin already existed: ${args.adminEmail}`);
      } else {
        await db.insert(users).values({
          email: args.adminEmail,
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          fullName: args.adminName ?? args.adminEmail,
          role: 'admin',
          organizationId: org.id,
        });
        console.log(`✓ admin created: ${args.adminEmail}`);
        if (!args.adminPassword) {
          console.log(`  temporary password: ${password}`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ seed:company failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
