/**
 * Điểm vào của bộ mock. Gọi trong src/main.tsx trước khi render:
 *
 *   import { enableMocking } from './mocks';
 *   enableMocking().then(() => createRoot(...).render(<App />));
 *
 * Chỉ bật khi VITE_USE_MOCK=true, nên build production không kéo MSW vào.
 */
import { MOCK_CONFIG } from './config';

export { createMockSocket, mockSocket } from './realtime';
export type { MockSocket, RealtimeEvent } from './realtime';

export const isMockEnabled = () => import.meta.env.VITE_USE_MOCK === 'true';

export async function enableMocking(): Promise<void> {
  if (!isMockEnabled()) return;

  const [{ worker }, store, jobs, ops, schedule] = await Promise.all([
    import('./browser'),
    import('./db/store'),
    import('./jobs'),
    import('./lib/ops'),
    import('./lib/schedule'),
  ]);

  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL ?? '/'}mockServiceWorker.js` },
  });

  store.load();

  // Job nền chạy định kỳ để đơn hết hạn giữ chỗ / tự hoàn thành dù không có request nào
  setInterval(() => {
    store.load();
    if (jobs.runJobs()) store.save();
  }, MOCK_CONFIG.jobsIntervalMs);

  // Tiện ích gõ trong DevTools console
  const helpers = {
    /** Giả lập khách chuyển khoản đúng số tiền: sporthubMock.pay('BK2026112501') */
    pay(code: string, override?: { amount?: number; content?: string }) {
      store.load();
      const { txn } = ops.simulateTransfer(schedule.mustBooking(code), override);
      store.save();
      return { matchStatus: txn.matchStatus, issue: txn.issue };
    },
    /** Khôi phục dữ liệu mẫu */
    reset() {
      store.reset();
      location.reload();
    },
    /** Đặt độ trễ mạng (ms) */
    latency(msValue: number) {
      localStorage.setItem('sporthub_mock_latency', String(msValue));
    },
    accounts() {
      store.load();
      console.table(
        store.db().users.map((u) => ({ role: u.role, name: u.fullName, phone: u.phone, email: u.email, password: u.password, status: u.status })),
      );
    },
    db: () => store.db(),
  };
  (window as unknown as { sporthubMock: typeof helpers }).sporthubMock = helpers;

  console.info(
    '%c[SportHub mock]%c API giả lập đang bật — gõ sporthubMock.accounts() để xem tài khoản demo (mật khẩu 123456).',
    'color:#fff;background:#16a34a;padding:2px 6px;border-radius:4px',
    'color:inherit',
  );
}
