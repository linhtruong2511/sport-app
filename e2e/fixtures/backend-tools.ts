import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Helper gọi `backend/dist/scripts/e2eTools.js` (R-15): kích hoạt job nền và dời thời gian của đơn test.
 * - Backend E2E chạy NODE_ENV=test nên cron tắt; job chỉ chạy khi test gọi.
 * - Job chạy ở tiến trình riêng nên KHÔNG phát socket: sau khi gọi, test phải reload / chờ API.
 * - Cần bản build backend (webServer trong playwright.config.ts đã chạy `npm run build`).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../..', 'backend');
const SCRIPT = path.join('dist', 'scripts', 'e2eTools.js');

export type E2eJobName =
  | 'expireHolds'
  | 'expireQr'
  | 'cancelNoShows'
  | 'closePaidNoShows'
  | 'autoComplete'
  | 'sendReminders'
  | 'retryPromoNotify';

interface ToolResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

function runTool(args: string[]): ToolResult {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TZ: 'Asia/Ho_Chi_Minh',
        DB_DATABASE: process.env.DB_TEST_DATABASE || 'SportHub_Test',
      },
    });
  } catch (err) {
    stdout = String((err as { stdout?: unknown }).stdout ?? '');
  }
  const lastLine = stdout.trim().split(/\r?\n/).pop() ?? '';
  let result: ToolResult;
  try {
    result = JSON.parse(lastLine) as ToolResult;
  } catch {
    throw new Error(`e2eTools ${args.join(' ')}: không đọc được kết quả.\n${stdout}`);
  }
  if (!result.ok) {
    throw new Error(`e2eTools ${args.join(' ')}: ${result.error}`);
  }
  return result;
}

/** Chạy một job nền một lần; trả về số bản ghi bị tác động. */
export function runJob(name: E2eJobName): number {
  return Number(runTool(['run-job', name]).affected);
}

/** Đưa HoldExpireAt và QR PENDING của đơn chờ thanh toán về quá khứ. */
export function expireHold(bookingCode: string): void {
  runTool(['expire-hold', bookingCode]);
}

/** Dời toàn bộ khung giờ của đơn (StartAt/EndAt, slots, price lines); được đổi ngày nhưng không được vắt qua nửa đêm. */
export function shiftBooking(bookingCode: string, minutes: number): void {
  runTool(['shift-booking', bookingCode, `--minutes=${minutes}`]);
}
