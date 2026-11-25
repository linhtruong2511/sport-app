import {
  apiFindBranchByCode,
  apiFindCourtByCode,
  apiGetAvailability,
  apiGetSports,
} from './api.js';

export function vnDateStr(daysAhead = 0): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000 + 7 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function vnNowParts(): { date: string; hour: number; minute: number; totalMinutes: number } {
  const d = new Date(Date.now() + 7 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    date: `${y}-${m}-${day}`,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * I-03: Tìm ngày mở cửa tiếp theo (>= today + minDaysAhead) không rơi vào ngày nghỉ lễ
 * hay bảo trì sân (F-04). Nếu truyền courtCode, đảm bảo sân ở trạng thái READY và có >= minFreeSlots ô trống.
 */
export async function nextOpenDate(
  branchCode: 'CS01' | 'CS02' = 'CS01',
  minDaysAhead = 3,
  courtCode?: string,
  minFreeSlots = 1,
): Promise<string> {
  const branch = await apiFindBranchByCode(branchCode);
  let sportId: number;
  if (courtCode) {
    const court = await apiFindCourtByCode(courtCode);
    sportId = court.sport.sportId;
  } else {
    const sports = await apiGetSports(branch.branchId);
    sportId = sports[0].sportId;
  }

  for (let offset = minDaysAhead; offset < minDaysAhead + 60; offset++) {
    const date = vnDateStr(offset);
    const avail = await apiGetAvailability({
      branchId: branch.branchId,
      sportId,
      date,
    });
    if (avail.holiday || avail.branch.isClosed || avail.slots.length === 0) {
      continue;
    }
    if (courtCode) {
      const court = avail.courts.find((c) => c.code === courtCode);
      if (!court || court.state !== 'READY') continue;
      const freeCount = court.cells.filter((cell) => cell.state === 'FREE').length;
      if (freeCount < minFreeSlots) continue;
    }
    return date;
  }

  throw new Error(
    `Không tìm thấy ngày mở cửa cho ${branchCode} (${courtCode ?? 'any'}) từ D+${minDaysAhead}.`,
  );
}
