import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../..', 'backend');

function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export default async function globalSetup(): Promise<void> {
  // I-05: kiểm tra cổng khi chạy mode skip-webserver hoặc cảnh báo rõ nếu chưa giải phóng cổng dev
  if (process.env.E2E_SKIP_WEBSERVER === '1') {
    const apiUp = await isPortListening(3000);
    const uiUp = await isPortListening(5173);
    if (!apiUp || !uiUp) {
      throw new Error(
        `E2E_SKIP_WEBSERVER=1 nhưng server chưa sẵn sàng (port 3000=${apiUp}, port 5173=${uiUp}).`,
      );
    }
  }

  if (process.env.E2E_SKIP_DB_RESET === '1') {
    return;
  }

  const testDb = process.env.DB_TEST_DATABASE || 'SportHub_Test';
  execFileSync('npx', ['tsx', 'src/scripts/dbReset.ts', `--db=${testDb}`], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TZ: 'Asia/Ho_Chi_Minh',
    },
  });
}
