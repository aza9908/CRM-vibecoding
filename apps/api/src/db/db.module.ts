import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema';

/**
 * DI token for the Drizzle database instance.
 * Inject in services via:
 *   constructor(@Inject(DRIZZLE) private db: Db) {}
 */
export const DRIZZLE = Symbol('DRIZZLE');

/** Convenience alias for the typed Drizzle database. */
export type Db = NodePgDatabase<typeof schema>;

/** DI token for the underlying pg Pool (exposed for graceful shutdown / health checks). */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const connectionString = config.get<string>('DATABASE_URL');
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        return new Pool({ connectionString });
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
