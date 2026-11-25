import {
  test as base,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
} from '@playwright/test';

/**
 * Playwright helper cho các kịch bản nghiệm thu UI (chạy với Backend + SQL Server SportHub_Test).
 * - Mặc định: chạy toàn bộ kịch bản; đặt `SRS_FULL=0` để đánh dấu các kịch bản nghiệm thu là `test.fixme`.
 */
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
