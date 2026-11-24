import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../errors.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class BranchScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED');
    }

    if (user.role === 'STAFF') {
      if (user.branchId === null) {
        throw new AppError('BRANCH_FORBIDDEN');
      }
      if (req.params?.branchId !== undefined) {
        const paramBranchId = Number(req.params.branchId);
        if (!Number.isNaN(paramBranchId) && paramBranchId !== user.branchId) {
          throw new AppError('BRANCH_FORBIDDEN');
        }
      }

      req.scopedBranchId = user.branchId;

      if (req.query && typeof req.query === 'object' && 'branchId' in req.query) {
        try {
          (req.query as Record<string, unknown>).branchId = String(user.branchId);
        } catch {
          // Express 5 req.query getter may be read-only; controllers use @ScopedBranchId()
        }
      }
      if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && 'branchId' in req.body) {
        (req.body as Record<string, unknown>).branchId = user.branchId;
      }
      return true;
    }

    if (user.role === 'OWNER') {
      const rawQueryBranch =
        req.query && typeof req.query === 'object' ? (req.query as Record<string, unknown>).branchId : undefined;
      const rawParamBranch = req.params?.branchId;
      const candidate = rawParamBranch ?? rawQueryBranch;
      if (candidate !== undefined && candidate !== '' && candidate !== 'all') {
        const parsed = Number(candidate);
        req.scopedBranchId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      } else {
        req.scopedBranchId = null;
      }
      return true;
    }

    throw new AppError('FORBIDDEN');
  }
}
