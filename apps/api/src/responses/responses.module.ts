import { Module } from '@nestjs/common';
import { ResponsesService } from './responses.service';

/**
 * Responses subsystem: persistence and read-back of participant answers to
 * workbook blocks. Consumed by:
 *   - the WebSocket gateway (`response:save` → upsert),
 *   - the sessions controller (teacher's "responses summary" endpoint).
 *
 * The DB (`DRIZZLE`) is provided by the global `DbModule`, so it does not need
 * to be imported here.
 */
@Module({
  providers: [ResponsesService],
  exports: [ResponsesService],
})
export class ResponsesModule {}
