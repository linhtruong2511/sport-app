import { Injectable } from '@nestjs/common';
import type { AudienceType, DiscountType, PromotionStatus } from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import { fromSqlDate, fromSqlTime, toSqlDate } from '../core/time.js';

export interface PublicPromotionRow {
  promotionId: number;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  allBranches: boolean;
  allSports: boolean;
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  audienceType: AudienceType;
  remainingUses: number;
  branchIds: number[];
  branchNames: string[];
  sportIds: number[];
  sportNames: string[];
}

export interface PromotionLookupByCode {
  promotionId: number;
  code: string;
  name: string;
  status: PromotionStatus;
  startDate: string;
  endDate: string;
  audienceType: AudienceType;
  maxUses: number;
  usedCount: number;
  isCustomerEligible: boolean;
}

@Injectable()
export class PromotionsRepository {
  async listPublicPromotions(
    exec: DbExecutor,
    params: {
      today: string;
      branchId?: number;
      sportId?: number;
      userId?: number;
      limit: number;
    },
  ): Promise<PublicPromotionRow[]> {
    const req = exec
      .request()
      .input('today', sql.Date, toSqlDate(params.today))
      .input('limit', sql.Int, params.limit);

    const conditions = [
      "p.Status = 'ACTIVE'",
      'p.StartDate <= @today',
      'p.EndDate >= @today',
      'p.UsedCount < p.MaxUses',
    ];

    if (params.branchId !== undefined) {
      req.input('branchId', sql.Int, params.branchId);
      conditions.push(
        '(p.AllBranches = 1 OR EXISTS (SELECT 1 FROM dbo.PromotionBranches pb WHERE pb.PromotionId = p.PromotionId AND pb.BranchId = @branchId))',
      );
    }

    if (params.sportId !== undefined) {
      req.input('sportId', sql.Int, params.sportId);
      conditions.push(
        '(p.AllSports = 1 OR EXISTS (SELECT 1 FROM dbo.PromotionSports ps WHERE ps.PromotionId = p.PromotionId AND ps.SportId = @sportId))',
      );
    }

    if (params.userId !== undefined) {
      req.input('userId', sql.BigInt, params.userId);
      conditions.push(
        "(p.AudienceType = 'ALL' OR (p.AudienceType = 'SPECIFIC' AND EXISTS (SELECT 1 FROM dbo.PromotionCustomers pc WHERE pc.PromotionId = p.PromotionId AND pc.CustomerId = @userId)))",
      );
    } else {
      conditions.push("p.AudienceType = 'ALL'");
    }

    const promoRes = await req.query<{
      PromotionId: number;
      Code: string;
      Name: string;
      DiscountType: DiscountType;
      DiscountValue: number | string;
      MaxDiscountAmount: number | string | null;
      AllBranches: boolean | number;
      AllSports: boolean | number;
      TimeFrom: Date | string | null;
      TimeTo: Date | string | null;
      StartDate: Date | string;
      EndDate: Date | string;
      AudienceType: AudienceType;
      MaxUses: number;
      UsedCount: number;
    }>(`
      SELECT TOP (@limit)
        p.PromotionId,
        p.Code,
        p.Name,
        p.DiscountType,
        p.DiscountValue,
        p.MaxDiscountAmount,
        p.AllBranches,
        p.AllSports,
        p.TimeFrom,
        p.TimeTo,
        p.StartDate,
        p.EndDate,
        p.AudienceType,
        p.MaxUses,
        p.UsedCount
      FROM dbo.Promotions p
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY p.EndDate ASC, p.PromotionId ASC
    `);

    const promos = promoRes.recordset;
    if (promos.length === 0) return [];

    const branchMap = new Map<number, { ids: number[]; names: string[] }>();
    const sportMap = new Map<number, { ids: number[]; names: string[] }>();

    const branchesReq = exec.request();
    const sportsReq = exec.request();

    const promoIdParams = promos
      .map((p, idx) => {
        const param = `promoId${idx}`;
        branchesReq.input(param, sql.Int, p.PromotionId);
        sportsReq.input(param, sql.Int, p.PromotionId);
        return `@${param}`;
      })
      .join(', ');

    const [branchesRes, sportsRes] = await Promise.all([
      branchesReq.query<{ PromotionId: number; BranchId: number; Name: string }>(`
        SELECT pb.PromotionId, pb.BranchId, b.Name
        FROM dbo.PromotionBranches pb
        JOIN dbo.Branches b ON b.BranchId = pb.BranchId
        WHERE pb.PromotionId IN (${promoIdParams})
        ORDER BY pb.BranchId ASC
      `),
      sportsReq.query<{ PromotionId: number; SportId: number; Name: string }>(`
        SELECT ps.PromotionId, ps.SportId, s.Name
        FROM dbo.PromotionSports ps
        JOIN dbo.Sports s ON s.SportId = ps.SportId
        WHERE ps.PromotionId IN (${promoIdParams})
        ORDER BY ps.SportId ASC
      `),
    ]);

    for (const row of branchesRes.recordset) {
      const entry = branchMap.get(row.PromotionId);
      if (entry) {
        entry.ids.push(row.BranchId);
        entry.names.push(row.Name);
      } else {
        branchMap.set(row.PromotionId, { ids: [row.BranchId], names: [row.Name] });
      }
    }

    for (const row of sportsRes.recordset) {
      const entry = sportMap.get(row.PromotionId);
      if (entry) {
        entry.ids.push(row.SportId);
        entry.names.push(row.Name);
      } else {
        sportMap.set(row.PromotionId, { ids: [row.SportId], names: [row.Name] });
      }
    }

    return promos.map((p) => {
      const allBranches = Boolean(p.AllBranches);
      const allSports = Boolean(p.AllSports);
      const bEntry = allBranches ? undefined : branchMap.get(p.PromotionId);
      const sEntry = allSports ? undefined : sportMap.get(p.PromotionId);

      return {
        promotionId: p.PromotionId,
        code: p.Code,
        name: p.Name,
        discountType: p.DiscountType,
        discountValue: Number(p.DiscountValue),
        maxDiscountAmount: p.MaxDiscountAmount !== null ? Number(p.MaxDiscountAmount) : null,
        allBranches,
        allSports,
        timeFrom: p.TimeFrom !== null ? fromSqlTime(p.TimeFrom) : null,
        timeTo: p.TimeTo !== null ? fromSqlTime(p.TimeTo) : null,
        startDate: fromSqlDate(p.StartDate),
        endDate: fromSqlDate(p.EndDate),
        audienceType: p.AudienceType,
        remainingUses: Number(p.MaxUses) - Number(p.UsedCount),
        branchIds: bEntry?.ids ?? [],
        branchNames: bEntry?.names ?? [],
        sportIds: sEntry?.ids ?? [],
        sportNames: sEntry?.names ?? [],
      };
    });
  }

  async findPublicByCode(
    exec: DbExecutor,
    code: string,
    userId?: number,
  ): Promise<PromotionLookupByCode | null> {
    const req = exec.request().input('code', sql.VarChar(20), code);
    if (userId !== undefined) {
      req.input('userId', sql.BigInt, userId);
    } else {
      req.input('userId', sql.BigInt, null);
    }

    const res = await req.query<{
      PromotionId: number;
      Code: string;
      Name: string;
      Status: PromotionStatus;
      StartDate: Date | string;
      EndDate: Date | string;
      AudienceType: AudienceType;
      MaxUses: number;
      UsedCount: number;
      IsCustomerEligible: boolean | number;
    }>(`
      SELECT
        p.PromotionId,
        p.Code,
        p.Name,
        p.Status,
        p.StartDate,
        p.EndDate,
        p.AudienceType,
        p.MaxUses,
        p.UsedCount,
        CASE
          WHEN @userId IS NOT NULL AND EXISTS (
            SELECT 1
            FROM dbo.PromotionCustomers pc
            WHERE pc.PromotionId = p.PromotionId
              AND pc.CustomerId = @userId
          ) THEN CAST(1 AS BIT)
          ELSE CAST(0 AS BIT)
        END AS IsCustomerEligible
      FROM dbo.Promotions p
      WHERE p.Code = @code
    `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      promotionId: row.PromotionId,
      code: row.Code,
      name: row.Name,
      status: row.Status,
      startDate: fromSqlDate(row.StartDate),
      endDate: fromSqlDate(row.EndDate),
      audienceType: row.AudienceType,
      maxUses: Number(row.MaxUses),
      usedCount: Number(row.UsedCount),
      isCustomerEligible: Boolean(row.IsCustomerEligible),
    };
  }
}
