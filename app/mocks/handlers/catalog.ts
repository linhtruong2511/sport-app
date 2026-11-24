/** API-03, 04, 07, 08, 24 — module catalog / promotions (công khai) */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { Promotion, User } from '../db/types';
import { ApiError } from '../lib/errors';
import { ok, route } from '../lib/http';
import { promoScopeText } from '../lib/mappers';
import { activeRules } from '../lib/pricing';
import { activeBlockNow, branchDay, liveBookingsOverlapping, mustBranch, slotsFor } from '../lib/schedule';
import { at, isDate, ms, nowMs, today } from '../lib/time';

const A = MOCK_CONFIG.apiBase;

function visiblePromo(p: Promotion, viewer: User | null) {
  if (p.status !== 'ACTIVE' || p.endDate < today() || p.usedCount >= p.maxUses) return false;
  if (p.audienceType === 'SPECIFIC') return !!viewer && p.customerIds.includes(viewer.userId);
  return true;
}

export const catalogHandlers = [
  // API-03
  http.get(`${A}/branches`, route((ctx) => {
    const all = ctx.q('status') === 'ALL' && ctx.viewer?.role === 'OWNER';
    const s = db();
    const data = s.branches
      .filter((b) => all || b.status === 'ACTIVE')
      .map((b) => ({
        branchId: b.branchId,
        code: b.code,
        name: b.name,
        address: b.address,
        phone: b.phone,
        description: b.description,
        courtCount: s.courts.filter((c) => c.branchId === b.branchId && c.status === 'ACTIVE').length,
        status: b.status,
        openingHours: b.openingHours,
      }));
    return ok(data);
  })),

  // API-04
  http.get(`${A}/sports`, route((ctx) => {
    const branchId = ctx.qNum('branchId');
    const s = db();
    const data = [...s.sports]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        sportId: sp.sportId,
        code: sp.code,
        name: sp.name,
        icon: sp.icon,
        gridBlockMinutes: sp.gridBlockMinutes,
        slotMinutes: sp.slotMinutes,
        activeCourtCount: s.courts.filter(
          (c) => c.sportId === sp.sportId && c.status === 'ACTIVE' && (branchId == null || c.branchId === branchId),
        ).length,
      }));
    return ok(data);
  })),

  // API-07
  http.get(`${A}/promotions/public`, route((ctx) => {
    const branchId = ctx.qNum('branchId');
    const sportId = ctx.qNum('sportId');
    const limit = ctx.qNum('limit') ?? 10;
    const data = db()
      .promotions.filter((p) => visiblePromo(p, ctx.viewer))
      .filter((p) => branchId == null || p.allBranches || p.branchIds.includes(branchId))
      .filter((p) => sportId == null || p.allSports || p.sportIds.includes(sportId))
      .slice(0, limit)
      .map((p) => ({
        promotionId: p.promotionId,
        code: p.code,
        name: p.name,
        description: p.description,
        discountType: p.discountType,
        discountValue: p.discountValue,
        maxDiscountAmount: p.maxDiscountAmount,
        timeFrom: p.timeFrom,
        timeTo: p.timeTo,
        startDate: p.startDate,
        endDate: p.endDate,
        scopeText: promoScopeText(p),
        branchIds: p.branchIds,
        sportIds: p.sportIds,
        audienceType: p.audienceType,
        remainingUses: p.maxUses - p.usedCount,
      }));
    return ok(data);
  })),

  // API-24
  http.get(`${A}/promotions/public/:code`, route((ctx) => {
    const code = ctx.p('code').toUpperCase();
    const p = db().promotions.find((x) => x.code === code);
    if (!p) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Mã khuyến mãi không tồn tại.');
    let message: string | null = null;
    if (p.status === 'DISCONTINUED' || p.endDate < today()) message = 'Chương trình ưu đãi đã kết thúc.';
    else if (p.status === 'PAUSED') message = 'Mã khuyến mãi đang tạm dừng.';
    else if (p.usedCount >= p.maxUses) message = 'Mã khuyến mãi đã hết lượt sử dụng.';
    else if (p.audienceType === 'SPECIFIC' && (!ctx.viewer || !p.customerIds.includes(ctx.viewer.userId))) {
      message = 'Mã chỉ dành cho khách hàng được chỉ định.';
    }
    return ok({ code: p.code, name: p.name, status: p.status, endDate: p.endDate, usable: message === null, message });
  })),

  // API-08
  http.get(`${A}/branches/:branchId/sport-summary`, route((ctx) => {
    const branch = mustBranch(Number(ctx.p('branchId')));
    const date = isDate(ctx.q('date')) ? ctx.q('date')! : today();
    const day = branchDay(branch, date);
    const s = db();
    const sports = s.sports
      .map((sp) => {
        const courts = s.courts.filter((c) => c.branchId === branch.branchId && c.sportId === sp.sportId && c.status === 'ACTIVE');
        if (!courts.length) return null;
        const prices = courts.flatMap((c) => activeRules(c).map((r) => r.pricePerHour));
        const slots = slotsFor(branch, sp, date);
        let free = 0;
        for (const c of courts) {
          if (activeBlockNow(c.courtId)?.blockType === 'DECOMMISSION') continue;
          for (const sl of slots) {
            const st = at(date, sl.start);
            const en = at(date, sl.end);
            if (ms(st) < nowMs()) continue;
            if (liveBookingsOverlapping(c.courtId, st, en).length) continue;
            if (s.blocks.some((bl) => bl.courtId === c.courtId && !bl.releasedAt && ms(bl.startAt) < ms(en) && (!bl.endAt || ms(bl.endAt) > ms(st)))) continue;
            free++;
          }
        }
        return {
          sportId: sp.sportId,
          code: sp.code,
          name: sp.name,
          courtCount: courts.length,
          minPricePerHour: Math.min(...prices),
          maxPricePerHour: Math.max(...prices),
          deposit: { type: courts[0].depositType, value: courts[0].depositValue },
          freeSlotCount: free,
        };
      })
      .filter(Boolean);
    return ok({
      branch: {
        branchId: branch.branchId,
        name: branch.name,
        address: branch.address,
        openTime: day.openTime,
        closeTime: day.closeTime,
        isClosed: day.isClosed,
        holiday: day.holiday,
      },
      sports,
    });
  })),
];
