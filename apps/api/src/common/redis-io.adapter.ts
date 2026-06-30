import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

/**
 * Socket.IO adapter wired to the @socket.io/redis-adapter so that rooms and
 * broadcasts (e.g. focus:changed within session:{id}) are synchronized across
 * multiple API instances from day one (see CLAUDE.md "грабли": WS events must
 * cross instances).
 *
 * Bootstrap (main.ts):
 *   const adapter = new RedisIoAdapter(app);
 *   await adapter.connectToRedis(redisUrl);
 *   app.useWebSocketAdapter(adapter);
 *
 * If Redis is unreachable we log and fall back to the in-memory adapter so a
 * single-instance dev setup still works.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string | string[] = '*',
  ) {
    super(app);
  }

  async connectToRedis(redisUrl: string): Promise<void> {
    try {
      const pubClient = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      const subClient = pubClient.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      this.pubClient = pubClient;
      this.subClient = subClient;
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Socket.IO Redis adapter connected');
    } catch (err) {
      this.logger.warn(
        `Could not connect Socket.IO Redis adapter, falling back to in-memory adapter: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.corsOrigin,
        credentials: true,
      },
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
