import { Global, Module } from '@nestjs/common';
import { TOKEN_VERIFIER } from '../core/auth/auth.types.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { TokenVersionCacheService } from './token-version-cache.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    TokenVersionCacheService,
    AuthService,
    { provide: TOKEN_VERIFIER, useExisting: AuthService },
  ],
  exports: [AuthService, TokenVersionCacheService, TOKEN_VERIFIER],
})
export class AuthModule {}
