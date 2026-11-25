import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../..', 'backend');

export default async function globalSetup(): Promise<void> {
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
