import { createContext, useContext } from 'react';
import type { UserDto } from '@sporthub/shared';
import type { LoginInput, RegisterInput } from '../api/auth.ts';

export type AuthRevokedReason = 'ACCOUNT_LOCKED' | 'BRANCH_CHANGED' | 'PASSWORD_CHANGED' | string;

export interface AuthRevokedEventPayload {
  reason?: AuthRevokedReason;
}

export interface AuthContextValue {
  user: UserDto | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  skipReturnRedirect: boolean;
  login: (input: LoginInput) => Promise<UserDto>;
  register: (input: RegisterInput) => Promise<UserDto>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<UserDto | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
