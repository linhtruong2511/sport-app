import {
  test as base,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
} from '@playwright/test';

/**
 * Pure-UI Playwright test helper (no backend required).
 * - Default mode (`npm test`): runs all complete prototype UI journeys (100% PASS)
 *   and marks SRS UI gaps as `test.fixme` with exact `UI-XX` audit annotations.
 * - Audit / TDD mode (`npm run test:srs-audit` or `SRS_FULL=1`): executes EVERY
 *   SRS UI compliance test directly against the prototype browser UI.
 */
// Prototype đã đáp ứng toàn bộ SRS nên mặc định luôn chạy các kịch bản nghiệm thu (đặt SRS_FULL=0 để quay lại chế độ fixme).
export const IS_SRS_FULL = process.env.SRS_FULL !== '0' && process.env.SRS_FULL !== 'false';

export type UiTestFn = (
  fixtures: PlaywrightTestArgs & PlaywrightTestOptions & PlaywrightWorkerArgs & PlaywrightWorkerOptions,
  testInfo: TestInfo,
) => Promise<void> | void;

export function srsUiGap(title: string, reason: string, fn: UiTestFn): void {
  const fullTitle = `${title} @srs-ui-gap`;
  const details = { annotation: { type: 'srs-ui-gap', description: reason } };
  if (IS_SRS_FULL) {
    base(fullTitle, details, fn);
  } else {
    base.fixme(fullTitle, details, fn);
  }
}

export { base as test };
