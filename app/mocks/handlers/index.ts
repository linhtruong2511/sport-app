import { adminHandlers } from './admin';
import { authHandlers } from './auth';
import { bookingHandlers } from './bookings';
import { catalogHandlers } from './catalog';
import { financeHandlers } from './finance';
import { notificationHandlers } from './notifications';
import { operationHandlers } from './operations';
import { posHandlers } from './pos';
import { systemHandlers } from './system';

/**
 * 73 API REST + webhook SePay + công cụ dev.
 * Muốn dùng backend thật cho một nhóm API: bỏ nhóm đó khỏi mảng dưới đây
 * (request sẽ tự đi tới server thật nhờ onUnhandledRequest: 'bypass').
 */
export const handlers = [
  ...authHandlers, //          API-01, 02, 06, 09, 10
  ...catalogHandlers, //       API-03, 04, 07, 08, 24
  ...bookingHandlers, //       API-11 → 20
  ...notificationHandlers, //  API-05, 21 → 23
  ...posHandlers, //           API-25 → 35
  ...operationHandlers, //     API-36 → 41
  ...adminHandlers, //         API-42 → 65
  ...financeHandlers, //       API-66 → 73
  ...systemHandlers, //        webhook + /__mock/*
];
