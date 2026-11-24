import { Module } from '@nestjs/common';
import { AdminPromotionsModule } from '../admin/promotions/admin-promotions.module.js';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { JobLockService } from './job-lock.service.js';
import { JobsService } from './jobs.service.js';
import { LifecycleJobsService } from './lifecycle-jobs.service.js';

@Module({
  imports: [
    BookingsModule,
    BookingStateModule,
    PaymentsModule,
    NotificationsModule,
    AdminPromotionsModule,
  ],
  providers: [JobLockService, LifecycleJobsService, JobsService],
  exports: [JobLockService, LifecycleJobsService, JobsService],
})
export class JobsModule {}
