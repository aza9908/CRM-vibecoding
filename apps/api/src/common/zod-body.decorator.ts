import { Body } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * Validate (and parse) the request body against a shared zod schema inline,
 * without decorating the whole handler:
 *
 *   create(@ZodBody(createLessonSchema) dto: CreateLessonDto) { ... }
 *
 * Equivalent to @Body(new ZodValidationPipe(schema)) but reads cleaner and
 * keeps the validation contract right next to the parameter type.
 */
export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));
