import { Global, Module } from '@nestjs/common';
import { OUTBOUND_NOTIFIER, StubOutboundNotifier } from './notifier/outbound-notifier.js';
import { BANK_GATEWAY, SepayBankGateway } from './sepay/bank-gateway.js';

@Global()
@Module({
  providers: [
    StubOutboundNotifier,
    { provide: OUTBOUND_NOTIFIER, useExisting: StubOutboundNotifier },
    SepayBankGateway,
    { provide: BANK_GATEWAY, useExisting: SepayBankGateway },
  ],
  exports: [OUTBOUND_NOTIFIER, BANK_GATEWAY, StubOutboundNotifier, SepayBankGateway],
})
export class IntegrationsModule {}
