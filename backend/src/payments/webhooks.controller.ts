import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type ProviderParamDto,
  type SepayWebhookDto,
  providerParamSchema,
  sepayWebhookSchema,
} from './payments.schemas.js';
import { PaymentsService } from './payments.service.js';
import { SepayWebhookAuthGuard } from './sepay-webhook-auth.guard.js';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller('webhooks/bank')
export class WebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':provider')
  @UseGuards(SepayWebhookAuthGuard)
  @HttpCode(HttpStatus.OK)
  async handleBankWebhook(
    @Param(new ZodValidationPipe(providerParamSchema)) params: ProviderParamDto,
    @Headers('authorization') authHeader: string | undefined,
    @Body(new ZodValidationPipe(sepayWebhookSchema)) body: SepayWebhookDto,
    @Req() req: RequestWithRawBody,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? body);
    return this.paymentsService.handleSepayWebhook(params.provider, authHeader, rawBody, body);
  }
}
