import { Inject, Injectable } from '@nestjs/common';
import type { UserRole, UserStatus } from '@sporthub/shared/enums';
import { CLOCK, type Clock } from '../core/clock.js';

export interface CachedAuthStatus {
  tokenVersion: number;
  status: UserStatus;
  role: UserRole;
  branchId: number | null;
}

interface CacheEntry extends CachedAuthStatus {
  expiresAtMs: number;
}

const TOKEN_VERSION_TTL_MS = 10_000;

@Injectable()
export class TokenVersionCacheService {
  private readonly store = new Map<number, CacheEntry>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  get(userId: number): CachedAuthStatus | null {
    const entry = this.store.get(userId);
    if (!entry) {
      return null;
    }
    if (this.clock.now().getTime() >= entry.expiresAtMs) {
      this.store.delete(userId);
      return null;
    }
    return {
      tokenVersion: entry.tokenVersion,
      status: entry.status,
      role: entry.role,
      branchId: entry.branchId,
    };
  }

  set(userId: number, entry: CachedAuthStatus): void {
    this.store.set(userId, {
      ...entry,
      expiresAtMs: this.clock.now().getTime() + TOKEN_VERSION_TTL_MS,
    });
  }

  invalidate(userId: number): void {
    this.store.delete(userId);
  }

  clear(): void {
    this.store.clear();
  }
}
