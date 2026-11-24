import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { UserRole } from '@sporthub/shared';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const ROLES_KEY = 'roles';
export const BRANCH_SCOPED_KEY = 'branchScoped';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const BranchScoped = () => SetMetadata(BRANCH_SCOPED_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);

export const ScopedBranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | null | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.scopedBranchId;
  },
);
