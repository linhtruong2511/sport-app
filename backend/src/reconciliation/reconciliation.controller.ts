import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type AuthenticatedUser,
  BranchScopeGuard,
  BranchScoped,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  ScopedBranchId,
} from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok, okList } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type BankTxnIdParam,
  type CompleteRefundDto,
  type FailRefundDto,
  type IgnoreBankTransactionDto,
  type ListBankTransactionsQuery,
  type ListCandidatesQuery,
  type ListRefundsQuery,
  type MatchBankTransactionDto,
  type RefundIdParam,
  type RefundToCustomerDto,
  bankTxnIdParamSchema,
  completeRefundSchema,
  failRefundSchema,
  ignoreBankTransactionSchema,
  listBankTransactionsQuerySchema,
  listCandidatesQuerySchema,
  listRefundsQuerySchema,
  matchBankTransactionSchema,
  refundIdParamSchema,
  refundToCustomerSchema,
} from './reconciliation.schemas.js';
import { ReconciliationService } from './reconciliation.service.js';

@Controller('reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Roles('STAFF', 'OWNER')
@BranchScoped()
export class ReconciliationController {
  constructor(
    private readonly service: ReconciliationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-67
  @Get('transactions')
  async listTransactions(
    @Query(new ZodValidationPipe(listBankTransactionsQuerySchema)) query: ListBankTransactionsQuery,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.service.listTransactions(query, scopedBranchId, user);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      {
        total: result.totalItems,
        countByStatus: result.countByStatus,
      },
    );
  }

  // API-68
  @Get('transactions/:bankTxnId/candidates')
  async listCandidates(
    @Param(new ZodValidationPipe(bankTxnIdParamSchema)) params: BankTxnIdParam,
    @Query(new ZodValidationPipe(listCandidatesQuerySchema)) query: ListCandidatesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const items = await this.service.listCandidates(params.bankTxnId, query, user);
    return ok(items, this.clock);
  }

  // API-69
  @Post('transactions/:bankTxnId/match')
  @HttpCode(HttpStatus.OK)
  async matchTransaction(
    @Param(new ZodValidationPipe(bankTxnIdParamSchema)) params: BankTxnIdParam,
    @Body(new ZodValidationPipe(matchBankTransactionSchema)) dto: MatchBankTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.matchTransaction(params.bankTxnId, dto, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-70
  @Post('transactions/:bankTxnId/refund-to-customer')
  @HttpCode(HttpStatus.OK)
  async refundToCustomer(
    @Param(new ZodValidationPipe(bankTxnIdParamSchema)) params: BankTxnIdParam,
    @Body(new ZodValidationPipe(refundToCustomerSchema)) dto: RefundToCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.refundToCustomer(params.bankTxnId, dto, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-71
  @Post('transactions/:bankTxnId/ignore')
  @HttpCode(HttpStatus.OK)
  async ignoreTransaction(
    @Param(new ZodValidationPipe(bankTxnIdParamSchema)) params: BankTxnIdParam,
    @Body(new ZodValidationPipe(ignoreBankTransactionSchema)) dto: IgnoreBankTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.ignoreTransaction(
      params.bankTxnId,
      dto ?? {},
      user,
      req.ip ?? null,
    );
    return ok(data, this.clock);
  }
}

@Controller('refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class RefundsController {
  constructor(
    private readonly service: ReconciliationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-72
  @Get()
  async listRefunds(
    @Query(new ZodValidationPipe(listRefundsQuerySchema)) query: ListRefundsQuery,
  ) {
    const result = await this.service.listRefunds(query);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      {
        total: result.totalItems,
        totalAmount: result.totalAmount,
        countByStatus: result.countByStatus,
      },
    );
  }

  // API-73a
  @Post(':refundId/complete')
  @HttpCode(HttpStatus.OK)
  async completeRefund(
    @Param(new ZodValidationPipe(refundIdParamSchema)) params: RefundIdParam,
    @Body(new ZodValidationPipe(completeRefundSchema)) dto: CompleteRefundDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.completeRefund(params.refundId, dto ?? {}, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-73b
  @Post(':refundId/fail')
  @HttpCode(HttpStatus.OK)
  async failRefund(
    @Param(new ZodValidationPipe(refundIdParamSchema)) params: RefundIdParam,
    @Body(new ZodValidationPipe(failRefundSchema)) dto: FailRefundDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.failRefund(params.refundId, dto, user, req.ip ?? null);
    return ok(data, this.clock);
  }
}
