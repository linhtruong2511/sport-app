import { Injectable } from '@nestjs/common';
import type { BranchStatus, DepositType } from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import { fromSqlTime, toSqlDateTime } from '../core/time.js';

export interface BranchOpeningHourDto {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface BranchCatalogItem {
  branchId: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  description: string | null;
  courtCount: number;
  status: BranchStatus;
  openingHours: BranchOpeningHourDto[];
}

export interface SportCatalogItem {
  sportId: number;
  code: string;
  name: string;
  icon: string | null;
  gridBlockMinutes: number;
  displayBlockMinutes: number;
  sortOrder: number;
  activeCourtCount: number;
}

export interface BranchSportStatItem {
  sportId: number;
  code: string;
  name: string;
  courtCount: number;
  minPricePerHour: number | null;
  maxPricePerHour: number | null;
  deposit: {
    type: DepositType;
    value: number;
  };
}

@Injectable()
export class CatalogRepository {
  async listBranches(exec: DbExecutor, includeInactive: boolean): Promise<BranchCatalogItem[]> {
    // NEVER select BankBin, BankName, BankAccountNo, BankAccountName on public catalog queries.
    const branchRes = await exec.request().query<{
      BranchId: number;
      Code: string;
      Name: string;
      Address: string;
      Phone: string | null;
      Description: string | null;
      Status: BranchStatus;
      CourtCount: number;
    }>(`
      SELECT
        b.BranchId,
        b.Code,
        b.Name,
        b.Address,
        b.Phone,
        b.Description,
        b.Status,
        COUNT(c.CourtId) AS CourtCount
      FROM dbo.Branches b
      LEFT JOIN dbo.Courts c
        ON c.BranchId = b.BranchId
       AND c.Status = 'ACTIVE'
      ${includeInactive ? '' : "WHERE b.Status = 'ACTIVE'"}
      GROUP BY b.BranchId, b.Code, b.Name, b.Address, b.Phone, b.Description, b.Status
      ORDER BY b.BranchId ASC
    `);

    const branches = branchRes.recordset;
    if (branches.length === 0) return [];

    const req = exec.request();
    const inClause = branches
      .map((b, idx) => {
        const param = `branchId${idx}`;
        req.input(param, sql.Int, b.BranchId);
        return `@${param}`;
      })
      .join(', ');

    const hoursRes = await req.query<{
      BranchId: number;
      DayOfWeek: number;
      OpenTime: Date | string | null;
      CloseTime: Date | string | null;
      IsClosed: boolean | number;
    }>(`
      SELECT BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed
      FROM dbo.BranchOpeningHours
      WHERE BranchId IN (${inClause})
      ORDER BY BranchId ASC, DayOfWeek ASC
    `);

    const hoursByBranch = new Map<number, BranchOpeningHourDto[]>();
    for (const h of hoursRes.recordset) {
      const isClosed = Boolean(h.IsClosed);
      const item: BranchOpeningHourDto = {
        dayOfWeek: Number(h.DayOfWeek),
        openTime: isClosed || h.OpenTime === null ? null : fromSqlTime(h.OpenTime),
        closeTime: isClosed || h.CloseTime === null ? null : fromSqlTime(h.CloseTime),
        isClosed,
      };
      const list = hoursByBranch.get(h.BranchId);
      if (list) {
        list.push(item);
      } else {
        hoursByBranch.set(h.BranchId, [item]);
      }
    }

    return branches.map((b) => ({
      branchId: b.BranchId,
      code: b.Code,
      name: b.Name,
      address: b.Address,
      phone: b.Phone,
      description: b.Description,
      courtCount: Number(b.CourtCount),
      status: b.Status,
      openingHours: hoursByBranch.get(b.BranchId) ?? [],
    }));
  }

  async listSports(exec: DbExecutor, branchId?: number): Promise<SportCatalogItem[]> {
    const req = exec.request();
    let branchFilter = '';
    if (branchId !== undefined) {
      req.input('branchId', sql.Int, branchId);
      branchFilter = 'AND c.BranchId = @branchId';
    }

    const res = await req.query<{
      SportId: number;
      Code: string;
      Name: string;
      Icon: string | null;
      GridBlockMinutes: number;
      DisplayBlockMinutes: number;
      SortOrder: number;
      ActiveCourtCount: number;
    }>(`
      SELECT
        s.SportId,
        s.Code,
        s.Name,
        s.Icon,
        s.GridBlockMinutes,
        s.DisplayBlockMinutes,
        s.SortOrder,
        COUNT(c.CourtId) AS ActiveCourtCount
      FROM dbo.Sports s
      LEFT JOIN dbo.Courts c
        ON c.SportId = s.SportId
       AND c.Status = 'ACTIVE'
       ${branchFilter}
      GROUP BY
        s.SportId,
        s.Code,
        s.Name,
        s.Icon,
        s.GridBlockMinutes,
        s.DisplayBlockMinutes,
        s.SortOrder
      ORDER BY s.SortOrder ASC, s.SportId ASC
    `);

    return res.recordset.map((row) => ({
      sportId: row.SportId,
      code: row.Code,
      name: row.Name,
      icon: row.Icon,
      gridBlockMinutes: Number(row.GridBlockMinutes),
      displayBlockMinutes: Number(row.DisplayBlockMinutes),
      sortOrder: Number(row.SortOrder),
      activeCourtCount: Number(row.ActiveCourtCount),
    }));
  }

  async getBranchSportStats(
    exec: DbExecutor,
    branchId: number,
    now: Date,
  ): Promise<BranchSportStatItem[]> {
    const courtsRes = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{
        SportId: number;
        SportCode: string;
        SportName: string;
        SortOrder: number;
        CourtId: number;
        DepositType: DepositType;
        DepositValue: number | string;
      }>(`
        SELECT
          s.SportId,
          s.Code AS SportCode,
          s.Name AS SportName,
          s.SortOrder,
          c.CourtId,
          c.DepositType,
          c.DepositValue
        FROM dbo.Courts c
        JOIN dbo.Sports s ON s.SportId = c.SportId
        WHERE c.BranchId = @branchId
          AND c.Status = 'ACTIVE'
        ORDER BY s.SortOrder ASC, s.SportId ASC, c.CourtId ASC
      `);

    if (courtsRes.recordset.length === 0) return [];

    const pricesRes = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<{
        SportId: number;
        MinPricePerHour: number | string | null;
        MaxPricePerHour: number | string | null;
      }>(`
        SELECT
          c.SportId,
          MIN(r.PricePerHour) AS MinPricePerHour,
          MAX(r.PricePerHour) AS MaxPricePerHour
        FROM dbo.Courts c
        JOIN dbo.CourtPriceRules r ON r.CourtId = c.CourtId
        WHERE c.BranchId = @branchId
          AND c.Status = 'ACTIVE'
          AND r.EffectiveFrom <= @now
          AND (r.EffectiveTo IS NULL OR r.EffectiveTo > @now)
        GROUP BY c.SportId
      `);

    const priceMap = new Map<number, { min: number | null; max: number | null }>();
    for (const p of pricesRes.recordset) {
      priceMap.set(p.SportId, {
        min: p.MinPricePerHour !== null ? Number(p.MinPricePerHour) : null,
        max: p.MaxPricePerHour !== null ? Number(p.MaxPricePerHour) : null,
      });
    }

    const grouped = new Map<number, BranchSportStatItem>();
    for (const row of courtsRes.recordset) {
      const existing = grouped.get(row.SportId);
      if (existing) {
        existing.courtCount += 1;
      } else {
        const prices = priceMap.get(row.SportId);
        grouped.set(row.SportId, {
          sportId: row.SportId,
          code: row.SportCode,
          name: row.SportName,
          courtCount: 1,
          minPricePerHour: prices?.min ?? null,
          maxPricePerHour: prices?.max ?? null,
          deposit: {
            type: row.DepositType,
            value: Number(row.DepositValue),
          },
        });
      }
    }

    return Array.from(grouped.values());
  }
}
