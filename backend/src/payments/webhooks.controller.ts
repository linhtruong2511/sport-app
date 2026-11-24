import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type ProviderParamDto,
  type SepayWebhookDto,
  providerParamSchema,
  sepayWebhookSchema,
} from './payments.schemas.js';
import { PaymentsService } from './payments.service.js';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller('webhooks/bank')
export class WebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':provider')
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
