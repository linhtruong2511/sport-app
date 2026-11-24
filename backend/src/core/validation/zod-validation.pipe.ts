import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ApiErrorDetail } from '@sporthub/shared/types';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../errors.js';

@Injectable()
export class ZodValidationPipe<TOutput = unknown> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodType<TOutput, ZodTypeDef, unknown>) {}

  transform(value: unknown): TOutput {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    const details: ApiErrorDetail[] = parsed.error.issues.map((issue) => ({
      ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
      message: issue.message,
    }));

    throw new AppError('VALIDATION_ERROR', { details });
  }
}
