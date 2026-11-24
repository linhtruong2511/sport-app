import { Injectable } from '@nestjs/common';
import type {
  AudienceType,
  DiscountType,
  PromotionNotifyStatus,
  PromotionStatus,
} from '@sporthub/shared/enums';
import { sql } from '../../config/database.js';
import { mapSqlError } from '../../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../../core/db/transaction.js';
import {
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  toIsoVn,
  toSqlDate,
  toSqlDateTime,
  toSqlTimeString,
} from '../../core/time.js';

export interface AdminPromotionDto {
  promotionId: number;
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  allBranches: boolean;
  branchIds: number[];
  branches: Array<{ branchId: number; name: string }>;
  allSports: boolean;
  sportIds: number[];
  sports: Array<{ sportId: number; name: string }>;
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  audienceType: AudienceType;
  customerCount: number;
  maxUses: number;
  usedCount: number;
  status: PromotionStatus;
  notifyStatus: PromotionNotifyStatus;
  isExpired: boolean;
  createdAt: string;
}

export interface AdminPromotionCustomerDto {
  userId: number;
  userCode: string;
  fullName: string;
  phone: string;
}

export interface AdminPromotionDetailDto extends AdminPromotionDto {
  customers: AdminPromotionCustomerDto[];
}

interface RawPromotionRow {
  PromotionId: number;
  Code: string;
  Name: string;
  Description: string | null;
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
  Status: PromotionStatus;
  NotifyStatus: PromotionNotifyStatus;
  CreatedAt: Date | string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_[\]]/g, '\\$&');
}

function buildIntInClause(
  ids: number[],
  req: ReturnType<DbExecutor['request']>,
  prefix: string,
): string {
  return ids
    .map((id, idx) => {
      const name = `${prefix}${idx}`;
      req.input(name, sql.Int, id);
      return `@${name}`;
    })
    .join(', ');
}

function mapPromotionRow(
  row: RawPromotionRow,
  branches: Array<{ branchId: number; name: string }>,
  sports: Array<{ sportId: number; name: string }>,
  customerCount: number,
  todayVn: string,
): AdminPromotionDto {
  const allBranches = Boolean(row.AllBranches);
  const allSports = Boolean(row.AllSports);
  const startDate = fromSqlDate(row.StartDate);
  const endDate = fromSqlDate(row.EndDate);
  const mappedBranches = allBranches ? [] : branches;
  const mappedSports = allSports ? [] : sports;

  return {
    promotionId: Number(row.PromotionId),
    code: row.Code,
    name: row.Name,
    description: row.Description ?? null,
    discountType: row.DiscountType,
    discountValue: Number(row.DiscountValue),
    maxDiscountAmount: row.MaxDiscountAmount !== null ? Number(row.MaxDiscountAmount) : null,
    allBranches,
    branchIds: mappedBranches.map((b) => b.branchId),
    branches: mappedBranches,
    allSports,
    sportIds: mappedSports.map((s) => s.sportId),
    sports: mappedSports,
    timeFrom: row.TimeFrom !== null ? fromSqlTime(row.TimeFrom) : null,
    timeTo: row.TimeTo !== null ? fromSqlTime(row.TimeTo) : null,
    startDate,
    endDate,
    audienceType: row.AudienceType,
    customerCount: row.AudienceType === 'SPECIFIC' ? customerCount : 0,
    maxUses: Number(row.MaxUses),
    usedCount: Number(row.UsedCount),
    status: row.Status,
    notifyStatus: row.NotifyStatus,
    isExpired: endDate < todayVn,
    createdAt: toIsoVn(fromSqlDateTime(row.CreatedAt)),
  };
}

@Injectable()
export class AdminPromotionsRepository {
  async listPromotions(
    exec: DbExecutor,
    filters: {
      status?: PromotionStatus;
      q?: string;
      audienceType?: AudienceType;
      page: number;
      pageSize: number;
    },
    todayVn: string,
  ): Promise<{ items: AdminPromotionDto[]; totalItems: number }> {
    const conditions: string[] = [];
    const bindFilters = (req: ReturnType<DbExecutor['request']>) => {
      if (filters.status !== undefined) {
        req.input('status', sql.VarChar(20), filters.status);
      }
      if (filters.audienceType !== undefined) {
        req.input('audienceType', sql.VarChar(20), filters.audienceType);
      }
      if (filters.q !== undefined) {
        req.input('qPattern', sql.NVarChar(180), `%${escapeLike(filters.q)}%`);
      }
      return req;
    };

    if (filters.status !== undefined) {
      conditions.push('p.Status = @status');
    }
    if (filters.audienceType !== undefined) {
      conditions.push('p.AudienceType = @audienceType');
    }
    if (filters.q !== undefined) {
      conditions.push("(p.Code LIKE @qPattern ESCAPE '\\' OR p.Name LIKE @qPattern ESCAPE '\\')");
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (filters.page - 1) * filters.pageSize;

    const countRes = await bindFilters(exec.request()).query<{ TotalItems: number }>(`
      SELECT COUNT(*) AS TotalItems
      FROM dbo.Promotions p
      ${whereSql}
    `);
    const totalItems = Number(countRes.recordset[0]?.TotalItems ?? 0);
    if (totalItems === 0) {
      return { items: [], totalItems: 0 };
    }

    const rowsRes = await bindFilters(exec.request())
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, filters.pageSize)
      .query<RawPromotionRow>(`
        SELECT
          p.PromotionId, p.Code, p.Name, p.Description, p.DiscountType, p.DiscountValue,
          p.MaxDiscountAmount, p.AllBranches, p.AllSports, p.TimeFrom, p.TimeTo,
          p.StartDate, p.EndDate, p.AudienceType, p.MaxUses, p.UsedCount,
          p.Status, p.NotifyStatus, p.CreatedAt
        FROM dbo.Promotions p
        ${whereSql}
        ORDER BY
          CASE p.Status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END,
          p.CreatedAt DESC,
          p.PromotionId DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

    const promos = rowsRes.recordset;
    if (promos.length === 0) {
      return { items: [], totalItems };
    }

    const promoIds = promos.map((p) => Number(p.PromotionId));

    const branchReq = exec.request();
    const branchIn = buildIntInClause(promoIds, branchReq, 'pid');
    const branchRes = await branchReq.query<{ PromotionId: number; BranchId: number; Name: string }>(`
      SELECT pb.PromotionId, pb.BranchId, b.Name
      FROM dbo.PromotionBranches pb
      INNER JOIN dbo.Branches b ON b.BranchId = pb.BranchId
      WHERE pb.PromotionId IN (${branchIn})
      ORDER BY pb.BranchId ASC
    `);

    const sportReq = exec.request();
    const sportIn = buildIntInClause(promoIds, sportReq, 'pid');
    const sportRes = await sportReq.query<{ PromotionId: number; SportId: number; Name: string }>(`
      SELECT ps.PromotionId, ps.SportId, s.Name
      FROM dbo.PromotionSports ps
      INNER JOIN dbo.Sports s ON s.SportId = ps.SportId
      WHERE ps.PromotionId IN (${sportIn})
      ORDER BY ps.SportId ASC
    `);

    const cusReq = exec.request();
    const cusIn = buildIntInClause(promoIds, cusReq, 'pid');
    const cusCountRes = await cusReq.query<{ PromotionId: number; CustomerCount: number }>(`
      SELECT pc.PromotionId, COUNT(*) AS CustomerCount
      FROM dbo.PromotionCustomers pc
      WHERE pc.PromotionId IN (${cusIn})
      GROUP BY pc.PromotionId
    `);

    const branchMap = new Map<number, Array<{ branchId: number; name: string }>>();
    for (const r of branchRes.recordset) {
      const pid = Number(r.PromotionId);
      const list = branchMap.get(pid) ?? [];
      list.push({ branchId: Number(r.BranchId), name: r.Name });
      branchMap.set(pid, list);
    }

    const sportMap = new Map<number, Array<{ sportId: number; name: string }>>();
    for (const r of sportRes.recordset) {
      const pid = Number(r.PromotionId);
      const list = sportMap.get(pid) ?? [];
      list.push({ sportId: Number(r.SportId), name: r.Name });
      sportMap.set(pid, list);
    }

    const cusCountMap = new Map<number, number>();
    for (const r of cusCountRes.recordset) {
      cusCountMap.set(Number(r.PromotionId), Number(r.CustomerCount));
    }

    const items = promos.map((p) => {
      const pid = Number(p.PromotionId);
      return mapPromotionRow(
        p,
        branchMap.get(pid) ?? [],
        sportMap.get(pid) ?? [],
        cusCountMap.get(pid) ?? 0,
        todayVn,
      );
    });

    return { items, totalItems };
  }

  async getPromotionDetail(
    exec: DbExecutor | TxContext,
    promotionId: number,
    todayVn: string,
  ): Promise<AdminPromotionDetailDto | null> {
    const lockHint = 'isTransaction' in exec ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const promoRes = await exec
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query<RawPromotionRow>(`
        SELECT
          PromotionId, Code, Name, Description, DiscountType, DiscountValue,
          MaxDiscountAmount, AllBranches, AllSports, TimeFrom, TimeTo,
          StartDate, EndDate, AudienceType, MaxUses, UsedCount,
          Status, NotifyStatus, CreatedAt
        FROM dbo.Promotions ${lockHint}
        WHERE PromotionId = @promotionId
      `);

    const row = promoRes.recordset[0];
    if (!row) {
      return null;
    }

    const branchRes = await exec
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query<{ BranchId: number; Name: string }>(`
        SELECT pb.BranchId, b.Name
        FROM dbo.PromotionBranches pb
        INNER JOIN dbo.Branches b ON b.BranchId = pb.BranchId
        WHERE pb.PromotionId = @promotionId
        ORDER BY pb.BranchId ASC
      `);

    const sportRes = await exec
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query<{ SportId: number; Name: string }>(`
        SELECT ps.SportId, s.Name
        FROM dbo.PromotionSports ps
        INNER JOIN dbo.Sports s ON s.SportId = ps.SportId
        WHERE ps.PromotionId = @promotionId
        ORDER BY ps.SportId ASC
      `);

    const customersRes = await exec
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query<{
        UserId: number | string;
        UserCode: string;
        FullName: string;
        Phone: string;
      }>(`
        SELECT u.UserId, u.Code AS UserCode, u.FullName, u.Phone
        FROM dbo.PromotionCustomers pc
        INNER JOIN dbo.Users u ON u.UserId = pc.CustomerId
        WHERE pc.PromotionId = @promotionId
        ORDER BY u.UserId ASC
      `);

    const branches = branchRes.recordset.map((r) => ({
      branchId: Number(r.BranchId),
      name: r.Name,
    }));
    const sports = sportRes.recordset.map((r) => ({
      sportId: Number(r.SportId),
      name: r.Name,
    }));
    const customers: AdminPromotionCustomerDto[] = customersRes.recordset.map((c) => ({
      userId: Number(c.UserId),
      userCode: c.UserCode,
      fullName: c.FullName,
      phone: c.Phone,
    }));

    return {
      ...mapPromotionRow(row, branches, sports, customers.length, todayVn),
      customers,
    };
  }

  async findMissingBranchIds(tx: TxContext, branchIds: number[]): Promise<number[]> {
    if (branchIds.length === 0) return [];
    const req = tx.request();
    const inClause = buildIntInClause(branchIds, req, 'bid');
    const res = await req.query<{ BranchId: number }>(`
      SELECT BranchId FROM dbo.Branches WHERE BranchId IN (${inClause})
    `);
    const found = new Set(res.recordset.map((r) => Number(r.BranchId)));
    return branchIds.filter((id) => !found.has(id));
  }

  async findMissingSportIds(tx: TxContext, sportIds: number[]): Promise<number[]> {
    if (sportIds.length === 0) return [];
    const req = tx.request();
    const inClause = buildIntInClause(sportIds, req, 'sid');
    const res = await req.query<{ SportId: number }>(`
      SELECT SportId FROM dbo.Sports WHERE SportId IN (${inClause})
    `);
    const found = new Set(res.recordset.map((r) => Number(r.SportId)));
    return sportIds.filter((id) => !found.has(id));
  }

  async findCustomersByPhones(
    tx: TxContext,
    phones: string[],
  ): Promise<Array<{ userId: number; phone: string }>> {
    if (phones.length === 0) return [];
    const req = tx.request();
    const inClause = phones
      .map((phone, idx) => {
        const name = `ph${idx}`;
        req.input(name, sql.VarChar(10), phone);
        return `@${name}`;
      })
      .join(', ');

    const res = await req.query<{ UserId: number | string; Phone: string }>(`
      SELECT UserId, Phone
      FROM dbo.Users
      WHERE Role = 'CUSTOMER'
        AND Phone IN (${inClause})
    `);

    return res.recordset.map((r) => ({
      userId: Number(r.UserId),
      phone: r.Phone,
    }));
  }

  async existsCode(
    tx: TxContext,
    code: string,
    excludePromotionId?: number,
  ): Promise<boolean> {
    const req = tx.request().input('code', sql.VarChar(20), code);
    let excludeClause = '';
    if (excludePromotionId !== undefined) {
      req.input('excludePromotionId', sql.Int, excludePromotionId);
      excludeClause = 'AND PromotionId <> @excludePromotionId';
    }
    const res = await req.query<{ PromotionId: number }>(`
      SELECT TOP 1 PromotionId
      FROM dbo.Promotions
      WHERE Code = @code
        ${excludeClause}
    `);
    return res.recordset.length > 0;
  }

  async insertPromotion(
    tx: TxContext,
    input: {
      code: string;
      name: string;
      description: string | null;
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
      maxUses: number;
      notifyStatus: PromotionNotifyStatus;
      createdBy: number;
      now: Date;
    },
  ): Promise<number> {
    try {
      const res = await tx
        .request()
        .input('code', sql.VarChar(20), input.code)
        .input('name', sql.NVarChar(150), input.name)
        .input('description', sql.NVarChar(1000), input.description)
        .input('discountType', sql.VarChar(10), input.discountType)
        .input('discountValue', sql.Decimal(18, 2), input.discountValue)
        .input('maxDiscountAmount', sql.Decimal(18, 0), input.maxDiscountAmount)
        .input('allBranches', sql.Bit, input.allBranches ? 1 : 0)
        .input('allSports', sql.Bit, input.allSports ? 1 : 0)
        .input('timeFrom', sql.VarChar(8), input.timeFrom ? toSqlTimeString(input.timeFrom) : null)
        .input('timeTo', sql.VarChar(8), input.timeTo ? toSqlTimeString(input.timeTo) : null)
        .input('startDate', sql.Date, toSqlDate(input.startDate))
        .input('endDate', sql.Date, toSqlDate(input.endDate))
        .input('audienceType', sql.VarChar(20), input.audienceType)
        .input('maxUses', sql.Int, input.maxUses)
        .input('notifyStatus', sql.VarChar(20), input.notifyStatus)
        .input('createdBy', sql.BigInt, input.createdBy)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query<{ PromotionId: number }>(`
          INSERT INTO dbo.Promotions (
            Code, Name, Description, DiscountType, DiscountValue, MaxDiscountAmount,
            AllBranches, AllSports, TimeFrom, TimeTo, StartDate, EndDate,
            AudienceType, MaxUses, UsedCount, Status, NotifyStatus,
            CreatedBy, CreatedAt, UpdatedAt
          )
          OUTPUT inserted.PromotionId
          VALUES (
            @code, @name, @description, @discountType, @discountValue, @maxDiscountAmount,
            @allBranches, @allSports,
            CASE WHEN @timeFrom IS NULL THEN NULL ELSE CAST(@timeFrom AS TIME(0)) END,
            CASE WHEN @timeTo IS NULL THEN NULL ELSE CAST(@timeTo AS TIME(0)) END,
            @startDate, @endDate,
            @audienceType, @maxUses, 0, 'ACTIVE', @notifyStatus,
            @createdBy, @now, @now
          )
        `);
      return Number(res.recordset[0].PromotionId);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async updatePromotion(
    tx: TxContext,
    input: {
      promotionId: number;
      code: string;
      name: string;
      description: string | null;
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
      maxUses: number;
      now: Date;
    },
  ): Promise<void> {
    try {
      await tx
        .request()
        .input('promotionId', sql.Int, input.promotionId)
        .input('code', sql.VarChar(20), input.code)
        .input('name', sql.NVarChar(150), input.name)
        .input('description', sql.NVarChar(1000), input.description)
        .input('discountType', sql.VarChar(10), input.discountType)
        .input('discountValue', sql.Decimal(18, 2), input.discountValue)
        .input('maxDiscountAmount', sql.Decimal(18, 0), input.maxDiscountAmount)
        .input('allBranches', sql.Bit, input.allBranches ? 1 : 0)
        .input('allSports', sql.Bit, input.allSports ? 1 : 0)
        .input('timeFrom', sql.VarChar(8), input.timeFrom ? toSqlTimeString(input.timeFrom) : null)
        .input('timeTo', sql.VarChar(8), input.timeTo ? toSqlTimeString(input.timeTo) : null)
        .input('startDate', sql.Date, toSqlDate(input.startDate))
        .input('endDate', sql.Date, toSqlDate(input.endDate))
        .input('audienceType', sql.VarChar(20), input.audienceType)
        .input('maxUses', sql.Int, input.maxUses)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query(`
          UPDATE dbo.Promotions
          SET Code = @code,
              Name = @name,
              Description = @description,
              DiscountType = @discountType,
              DiscountValue = @discountValue,
              MaxDiscountAmount = @maxDiscountAmount,
              AllBranches = @allBranches,
              AllSports = @allSports,
              TimeFrom = CASE WHEN @timeFrom IS NULL THEN NULL ELSE CAST(@timeFrom AS TIME(0)) END,
              TimeTo = CASE WHEN @timeTo IS NULL THEN NULL ELSE CAST(@timeTo AS TIME(0)) END,
              StartDate = @startDate,
              EndDate = @endDate,
              AudienceType = @audienceType,
              MaxUses = @maxUses,
              UpdatedAt = @now
          WHERE PromotionId = @promotionId
        `);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async replacePromotionRelations(
    tx: TxContext,
    promotionId: number,
    relations: {
      branchIds: number[];
      sportIds: number[];
      customerIds: number[];
    },
  ): Promise<void> {
    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionBranches WHERE PromotionId = @promotionId`);

    for (const branchId of relations.branchIds) {
      await tx
        .request()
        .input('promotionId', sql.Int, promotionId)
        .input('branchId', sql.Int, branchId)
        .query(`INSERT INTO dbo.PromotionBranches (PromotionId, BranchId) VALUES (@promotionId, @branchId)`);
    }

    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionSports WHERE PromotionId = @promotionId`);

    for (const sportId of relations.sportIds) {
      await tx
        .request()
        .input('promotionId', sql.Int, promotionId)
        .input('sportId', sql.Int, sportId)
        .query(`INSERT INTO dbo.PromotionSports (PromotionId, SportId) VALUES (@promotionId, @sportId)`);
    }

    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionCustomers WHERE PromotionId = @promotionId`);

    for (const customerId of relations.customerIds) {
      await tx
        .request()
        .input('promotionId', sql.Int, promotionId)
        .input('customerId', sql.BigInt, customerId)
        .query(`INSERT INTO dbo.PromotionCustomers (PromotionId, CustomerId) VALUES (@promotionId, @customerId)`);
    }
  }

  async updateStatus(
    tx: TxContext,
    promotionId: number,
    status: PromotionStatus,
    now: Date,
  ): Promise<void> {
    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .input('status', sql.VarChar(20), status)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Promotions
        SET Status = @status,
            UpdatedAt = @now
        WHERE PromotionId = @promotionId
      `);
  }

  async deletePromotionHard(tx: TxContext, promotionId: number): Promise<void> {
    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionCustomers WHERE PromotionId = @promotionId`);

    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionBranches WHERE PromotionId = @promotionId`);

    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.PromotionSports WHERE PromotionId = @promotionId`);

    await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .query(`DELETE FROM dbo.Promotions WHERE PromotionId = @promotionId`);
  }

  async findTargetCustomerIdsForPromo(
    tx: TxContext,
    promotionId: number,
    audienceType: AudienceType,
  ): Promise<number[]> {
    if (audienceType === 'SPECIFIC') {
      const res = await tx
        .request()
        .input('promotionId', sql.Int, promotionId)
        .query<{ UserId: number | string }>(`
          SELECT pc.CustomerId AS UserId
          FROM dbo.PromotionCustomers pc
          INNER JOIN dbo.Users u ON u.UserId = pc.CustomerId
          WHERE pc.PromotionId = @promotionId
            AND u.Role = 'CUSTOMER'
            AND u.Status = 'ACTIVE'
          ORDER BY pc.CustomerId ASC
        `);
      return res.recordset.map((r) => Number(r.UserId));
    }

    const res = await tx.request().query<{ UserId: number | string }>(`
      SELECT UserId
      FROM dbo.Users
      WHERE Role = 'CUSTOMER'
        AND Status = 'ACTIVE'
      ORDER BY UserId ASC
    `);
    return res.recordset.map((r) => Number(r.UserId));
  }

  async findAlreadyNotifiedUserIds(
    tx: TxContext,
    promotionId: number,
    promoCode: string,
  ): Promise<Set<number>> {
    const res = await tx
      .request()
      .input('promoCode', sql.VarChar(50), promoCode)
      .input('promoIdStr', sql.VarChar(50), String(promotionId))
      .query<{ UserId: number | string }>(`
        SELECT DISTINCT UserId
        FROM dbo.Notifications
        WHERE Type = 'PROMOTION'
          AND LinkType = 'PROMOTION'
          AND (LinkRef = @promoCode OR LinkRef = @promoIdStr)
      `);
    return new Set(res.recordset.map((r) => Number(r.UserId)));
  }

  async updateNotifyStatus(
    exec: DbExecutor | TxContext,
    promotionId: number,
    notifyStatus: PromotionNotifyStatus,
    now: Date,
  ): Promise<void> {
    await exec
      .request()
      .input('promotionId', sql.Int, promotionId)
      .input('notifyStatus', sql.VarChar(20), notifyStatus)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Promotions
        SET NotifyStatus = @notifyStatus,
            UpdatedAt = @now
        WHERE PromotionId = @promotionId
      `);
  }

  async listFailedNotifyPromotionIds(exec: DbExecutor, batchSize: number): Promise<number[]> {
    const res = await exec
      .request()
      .input('batchSize', sql.Int, batchSize)
      .query<{ PromotionId: number }>(`
        SELECT TOP (@batchSize) PromotionId
        FROM dbo.Promotions
        WHERE NotifyStatus = 'FAILED'
          AND Status <> 'DISCONTINUED'
        ORDER BY UpdatedAt ASC, PromotionId ASC
      `);
    return res.recordset.map((r) => Number(r.PromotionId));
  }
}
