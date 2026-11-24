import { USER_ROLE_TITLES } from '@sporthub/shared/enums';
import type { UserDto } from '@sporthub/shared/types';
import type { UserRow } from './auth.repository.js';

export function resolveUserTitle(role: UserRow['Role'], memberTier: string | null): string {
  if (role === 'OWNER') {
    return USER_ROLE_TITLES.OWNER;
  }
  if (role === 'STAFF') {
    return USER_ROLE_TITLES.STAFF;
  }
  return memberTier ?? USER_ROLE_TITLES.CUSTOMER;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    userId: Number(row.UserId),
    code: row.Code,
    fullName: row.FullName,
    phone: row.Phone,
    email: row.Email,
    role: row.Role,
    branchId: row.BranchId,
    branchName: row.BranchName,
    memberTier: row.MemberTier,
    title: resolveUserTitle(row.Role, row.MemberTier),
  };
}
