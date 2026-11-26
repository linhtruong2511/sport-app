import { Module } from '@nestjs/common';
import { AdminCourtsModule } from './admin/courts/admin-courts.module.js';
import { AdminPromotionsModule } from './admin/promotions/admin-promotions.module.js';
import { AdminBranchesModule } from './admin/branches/admin-branches.module.js';
import { AdminSettingsModule } from './admin/settings/admin-settings.module.js';
import { AdminStaffModule } from './admin/staff/admin-staff.module.js';
import { AffectedBookingsModule } from './affected-bookings/affected-bookings.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingStateModule } from './bookings/booking-state.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CoreModule } from './core/core.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PosModule } from './pos/pos.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PromotionsModule } from './promotions/promotions.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { ReportsModule } from './reports/reports.module.js';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    IntegrationsModule,
    AuthModule,
    PricingModule,
    AvailabilityModule,
    CatalogModule,
    PromotionsModule,
    NotificationsModule,
    BookingStateModule,
    PaymentsModule,
    BookingsModule,
    AffectedBookingsModule,
    PosModule,
    AdminCourtsModule,
    AdminStaffModule,
    AdminPromotionsModule,
    AdminBranchesModule,
    AdminSettingsModule,
    DashboardModule,
    ReportsModule,
    ReconciliationModule,
    JobsModule,
    HealthModule,
  ],
})
export class AppModule {}
