import type { UserRole } from '@sporthub/shared';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: number;
  role: UserRole;
  branchId: number | null;
  tv: number;
}

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  scopedBranchId?: number | null;
  traceId?: string;
}
