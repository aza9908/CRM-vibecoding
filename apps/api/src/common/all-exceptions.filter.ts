import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Catch-all exception filter.
 *
 * Without a global filter, any thrown plain `Error` (e.g. a misconfigured
 * storage client, an unexpected DB failure) bubbles up as an opaque
 * `500 Internal Server Error` with no structured body — exactly the symptom
 * reported for image uploads. This filter:
 *
 *  - passes `HttpException`s through with their intended status/body,
 *  - logs the full stack for everything else (so real 500s are debuggable),
 *  - and always returns a consistent JSON envelope, never a leaked stack.
 *
 * Registered globally in `main.ts`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // Already an HttpException (BadRequest, Unauthorized, ...): honour it.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `${req.method} ${req.url} -> ${status}`,
          (exception as Error).stack,
        );
      }
      res.status(status).json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
      return;
    }

    // Anything else is an unexpected server fault. Log it, return a clean 500.
    const err = exception as Error;
    this.logger.error(
      `Unhandled exception on ${req.method} ${req.url}: ${err?.message ?? exception}`,
      err?.stack,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal_error',
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
