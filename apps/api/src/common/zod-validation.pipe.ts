import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Nest pipe that validates a value against a zod schema and returns the parsed
 * (and coerced/defaulted) result.
 *
 * Usage with @UsePipes — validates the whole handler payload:
 *   @UsePipes(new ZodValidationPipe(loginSchema))
 *   login(@Body() dto: LoginDto) { ... }
 *
 * Or via the @ZodBody() decorator (src/common/zod-body.decorator.ts) to
 * validate just the request body inline.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: formatZodError(result.error),
      });
    }
    return result.data;
  }
}

function formatZodError(error: ZodError): Record<string, string[]> {
  const flat = error.flatten();
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    if (messages && messages.length) {
      fieldErrors[key] = messages;
    }
  }
  if (flat.formErrors.length) {
    fieldErrors._errors = flat.formErrors;
  }
  return fieldErrors;
}
