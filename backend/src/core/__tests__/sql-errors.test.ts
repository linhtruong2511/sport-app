import { describe, expect, it } from 'vitest';
import { isSqlDeadlockError, isTransientDbError } from '../db/sql-errors.js';

describe('isTransientDbError (C-4)', () => {
  it('treats deadlock victims, timeouts and lost connections as transient', () => {
    expect(isSqlDeadlockError({ number: 1205 })).toBe(true);
    expect(isTransientDbError({ number: 1205 })).toBe(true);
    expect(isTransientDbError({ code: 'ETIMEOUT' })).toBe(true);
    expect(isTransientDbError({ code: 'ECONNCLOSED' })).toBe(true);
    expect(isTransientDbError({ code: 'ESOCKET' })).toBe(true);
  });

  it('does not treat logic/data errors as transient', () => {
    expect(isTransientDbError(new Error('CHECK constraint violated'))).toBe(false);
    expect(isTransientDbError({ number: 547, code: 'EREQUEST' })).toBe(false);
    expect(isTransientDbError({ number: 2627 })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError('boom')).toBe(false);
  });
});
