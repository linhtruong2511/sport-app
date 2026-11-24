import { sql } from '../config/database.js';
import type { TxContext } from './db/transaction.js';

export type CodePrefix = 'BK' | 'PT' | 'KH' | 'NV' | 'CH';

export async function nextCode(
  tx: TxContext,
  prefix: CodePrefix,
  dateKey?: string | null,
): Promise<string> {
  const req = tx.request();
  req.input('Prefix', sql.VarChar(10), prefix);
  req.input('DateKey', sql.Char(8), dateKey ?? null);
  req.output('Code', sql.VarChar(20));

  const result = await req.execute('dbo.usp_NextCode');
  const code = result.output.Code as string | undefined;
  if (!code) {
    throw new Error(`dbo.usp_NextCode did not return @Code for prefix "${prefix}"`);
  }
  return code;
}
