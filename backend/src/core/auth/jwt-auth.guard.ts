import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { AppError } from '../errors.js';
import {
  type AuthenticatedRequest,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from './auth.types.js';

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Optional() @Inject(TOKEN_VERIFIER) private readonly tokenVerifier?: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (!this.tokenVerifier) {
      throw new AppError('INTERNAL_ERROR');
    }
    req.user = await this.tokenVerifier.verifyAccessToken(token);
    return true;
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    @Optional() @Inject(TOKEN_VERIFIER) private readonly tokenVerifier?: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      req.user = undefined;
      return true;
    }
    const token = extractBearerToken(authHeader);
    if (!token) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (!this.tokenVerifier) {
      throw new AppError('INTERNAL_ERROR');
    }
    req.user = await this.tokenVerifier.verifyAccessToken(token);
    return true;
  }
}
