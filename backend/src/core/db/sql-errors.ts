import type { ErrorCode } from '@sporthub/shared/errors';
import { AppError } from '../errors.js';

interface SqlErrorLike {
  number?: number;
  code?: string;
  message?: string;
  originalError?: {
    number?: number;
    message?: string;
    info?: {
      number?: number;
      message?: string;
    };
  };
  precedingErrors?: Array<{ number?: number; message?: string }>;
}

const CONSTRAINT_ERROR_MAP: ReadonlyArray<{ constraint: string; code: ErrorCode }> = [
  { constraint: 'UX_BookingSlots_Court_Slot', code: 'SLOT_TAKEN' },
  { constraint: 'UQ_Users_Phone', code: 'PHONE_TAKEN' },
  { constraint: 'UX_Users_Email', code: 'EMAIL_TAKEN' },
  { constraint: 'UQ_Courts_Branch_Name', code: 'COURT_NAME_DUPLICATE' },
  { constraint: 'UQ_Promotions_Code', code: 'PROMO_CODE_DUPLICATE' },
];

export function getSqlErrorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as SqlErrorLike;
  if (typeof e.number === 'number') return e.number;
  if (typeof e.originalError?.info?.number === 'number') return e.originalError.info.number;
  if (typeof e.originalError?.number === 'number') return e.originalError.number;
  const firstPreceding = e.precedingErrors?.find((p) => typeof p.number === 'number');
  return firstPreceding?.number;
}

export function getSqlErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as SqlErrorLike;
  const parts = [
    e.message,
    e.originalError?.message,
    e.originalError?.info?.message,
    ...(e.precedingErrors?.map((p) => p.message) ?? []),
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);
  return parts.join(' | ');
}

export function isSqlUniqueViolation(err: unknown): boolean {
  const num = getSqlErrorNumber(err);
  return num === 2601 || num === 2627;
}

export function isSqlDeadlockError(err: unknown): boolean {
  return getSqlErrorNumber(err) === 1205;
}

export function mapSqlError(err: unknown): never {
  if (isSqlUniqueViolation(err)) {
    const message = getSqlErrorMessage(err);
    for (const mapping of CONSTRAINT_ERROR_MAP) {
      if (message.includes(mapping.constraint)) {
        throw new AppError(mapping.code, { cause: err });
      }
    }
  }
  throw err;
}
