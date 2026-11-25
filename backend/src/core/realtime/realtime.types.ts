import type { AuthenticatedUser } from '../auth/auth.types.js';

export interface BookingAccessChecker {
  canAccessBooking(bookingCode: string, caller: AuthenticatedUser): Promise<boolean>;
}

export const BOOKING_ACCESS_CHECKER = Symbol('BOOKING_ACCESS_CHECKER');
