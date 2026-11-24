import { Injectable } from '@nestjs/common';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { AppLogger } from '../../core/logger.js';

export interface SepayIncomingTxn {
  id: number | string;
  gateway?: string | null;
  transactionDate: string;
  accountNumber: string;
  code?: string | null;
  content?: string | null;
  transferType: 'in' | 'out' | string;
  transferAmount: number;
  accumulated?: number | null;
  subAccount?: string | null;
  referenceCode?: string | null;
  description?: string | null;
}

export interface BankGatewayQuery {
  accountNumber: string;
  limit?: number;
}

export interface BankGateway {
  findTransactions(query: BankGatewayQuery): Promise<SepayIncomingTxn[]>;
}

export const BANK_GATEWAY = Symbol('BANK_GATEWAY');

interface SepayListResponse {
  status?: number;
  transactions?: Array<{
    id: string | number;
    bank_brand_name?: string;
    transaction_date?: string;
    account_number?: string;
    transaction_content?: string;
    amount_in?: string | number;
    amount_out?: string | number;
    accumulated?: string | number;
    sub_account?: string | null;
    reference_number?: string | null;
  }>;
}

@Injectable()
export class SepayBankGateway implements BankGateway {
  constructor(private readonly logger: AppLogger) {}

  async findTransactions(query: BankGatewayQuery): Promise<SepayIncomingTxn[]> {
    const url = new URL(`${env.sepayApiUrl.replace(/\/+$/, '')}/transactions/list`);
    url.searchParams.set('account_number', query.accountNumber);
    url.searchParams.set('limit', String(query.limit ?? 20));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(env.sepayApiToken ? { Authorization: `Bearer ${env.sepayApiToken}` } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`SePay API returned HTTP ${response.status}`, {
          context: 'SepayBankGateway',
        });
        throw new AppError('PAYMENT_GATEWAY_ERROR');
      }

      const json = (await response.json()) as SepayListResponse;
      const rows = Array.isArray(json.transactions) ? json.transactions : [];
      return rows.map((row) => {
        const amountIn = Number(row.amount_in ?? 0);
        const amountOut = Number(row.amount_out ?? 0);
        const isIn = amountIn > 0;
        return {
          id: row.id,
          gateway: row.bank_brand_name ?? null,
          transactionDate: row.transaction_date ?? '',
          accountNumber: row.account_number ?? query.accountNumber,
          content: row.transaction_content ?? '',
          transferType: isIn ? 'in' : 'out',
          transferAmount: isIn ? amountIn : amountOut,
          accumulated: row.accumulated !== undefined ? Number(row.accumulated) : null,
          subAccount: row.sub_account ?? null,
          referenceCode: row.reference_number ?? null,
        };
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      this.logger.warn('Failed to query SePay gateway', {
        context: 'SepayBankGateway',
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new AppError('PAYMENT_GATEWAY_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FakeBankGateway implements BankGateway {
  private transactions: SepayIncomingTxn[] = [];
  private nextError: Error | null = null;

  setTransactions(txns: SepayIncomingTxn[]): void {
    this.transactions = [...txns];
  }

  addTransaction(txn: SepayIncomingTxn): void {
    this.transactions.push(txn);
  }

  setNextError(err: Error | null): void {
    this.nextError = err;
  }

  clear(): void {
    this.transactions = [];
    this.nextError = null;
  }

  async findTransactions(query: BankGatewayQuery): Promise<SepayIncomingTxn[]> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.transactions
      .filter((t) => t.accountNumber === query.accountNumber)
      .slice(0, query.limit ?? 20);
  }
}
