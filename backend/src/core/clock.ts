import { Injectable } from '@nestjs/common';

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private current: Date;

  constructor(initial?: Date) {
    this.current = initial ? new Date(initial.getTime()) : new Date();
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advanceMinutes(n: number): void {
    this.current = new Date(this.current.getTime() + n * 60_000);
  }

  advanceSeconds(n: number): void {
    this.current = new Date(this.current.getTime() + n * 1_000);
  }
}
