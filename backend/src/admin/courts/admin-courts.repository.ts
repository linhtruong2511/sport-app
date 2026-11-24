import { Injectable } from '@nestjs/common';
import type { BlockType, CourtStatus, DepositType } from '@sporthub/shared/enums';
import { sql } from '../../config/database.js';
import { mapSqlError } from '../../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import {
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  toIsoVn,
  toSqlDate,
  toSqlDateTime,
  toSqlTimeString,
} from '../../core/time.js';
import type { OpeningHoursDayDto, PriceRuleInputDto } from './admin-courts.schemas.js';

export type CourtDisplayStatus = 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED' | 'INACTIVE';

export interface AdminCourtPriceRuleDto {
  priceRuleId: number;
  label: string;
  dayOfWeekMask: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
}

export interface AdminCourtActiveBlockDto {
  blockId: number;
  blockType: BlockType;
  startAt: string;
  endAt: string | null;
  reason: string;
}

export interface AdminCourtDto {
  courtId: number;
  code: string;
  name: string;
  branch: {
    branchId: number;
    name: string;
  };
  sport: {
    sportId: number;
    code: string;
    name: string;
  };
  courtType: string | null;
  description: string | null;
  depositType: DepositType;
  depositValue: number;
  status: CourtStatus;
  displayStatus: CourtDisplayStatus;
  priceRules: AdminCourtPriceRuleDto[];
  activeBlock: AdminCourtActiveBlockDto | null;
}

export interface AdminCourtDetailDto extends AdminCourtDto {
  hasOpenBookings: boolean;
}

export interface AdminCourtBlockListItemDto {
  blockId: number;
  court: {
    courtId: number;
    code: string;
    name: string;
    branchName: string;
  };
  blockType: BlockType;
  startAt: string;
  endAt: string | null;
  reason: string;
  createdByName: string;
  createdAt: string;
}

export interface AdminHolidayDto {
  holidayId: number;
  branch: {
    branchId: number;
    name: string;
  };
  startDate: string;
  endDate: string;
  reason: string | null;
  groupKey: string | null;
}

export interface CourtBlockRecord {
  blockId: number;
  courtId: number;
  branchId: number;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  reason: string;
  releasedAt: Date | null;
}

export interface HolidayRecord {
  holidayId: number;
  branchId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  groupKey: string | null;
}

const SPORT_ABBR_MAP: Record<string, string> = {
  PICKLEBALL: 'PB',
  BADMINTON: 'CL',
  BASKETBALL: 'BR',
  FOOTBALL: 'BD',
  TENNIS: 'TN',
};

interface RawCourtRow {
  CourtId: number;
  Code: string;
  Name: string;
  BranchId: number;
  BranchName: string;
  SportId: number;
  SportCode: string;
  SportName: string;
  CourtType: string | null;
  Description: string | null;
  DepositType: DepositType;
  DepositValue: number;
  Status: CourtStatus;
}

interface RawPriceRuleRow {
  PriceRuleId: number | string;
  CourtId: number;
  Label: string;
  DayOfWeekMask: number;
  StartTime: Date | string;
  EndTime: Date | string;
  PricePerHour: number;
}

interface RawBlockRow {
  BlockId: number | string;
  CourtId: number;
  BlockType: BlockType;
  StartAt: Date | string;
  EndAt: Date | string | null;
  Reason: string;
}

function buildIntInClause(ids: number[], req: ReturnType<DbExecutor['request']>, prefix: string): string {
  return ids
    .map((id, idx) => {
      const name = `${prefix}${idx}`;
      req.input(name, sql.Int, id);
      return `@${name}`;
    })
    .join(', ');
}

function mapCourtsWithRelations(
  courts: RawCourtRow[],
  rules: RawPriceRuleRow[],
  blocks: RawBlockRow[],
  now: Date,
): AdminCourtDto[] {
  const rulesByCourt = new Map<number, AdminCourtPriceRuleDto[]>();
  for (const r of rules) {
    const cid = Number(r.CourtId);
    const list = rulesByCourt.get(cid) ?? [];
    list.push({
      priceRuleId: Number(r.PriceRuleId),
      label: r.Label,
      dayOfWeekMask: Number(r.DayOfWeekMask),
      startTime: fromSqlTime(r.StartTime),
      endTime: fromSqlTime(r.EndTime),
      pricePerHour: Number(r.PricePerHour),
    });
    rulesByCourt.set(cid, list);
  }

  const blocksByCourt = new Map<number, Array<{ blockId: number; blockType: BlockType; startAt: Date; endAt: Date | null; reason: string }>>();
  for (const b of blocks) {
    const cid = Number(b.CourtId);
    const list = blocksByCourt.get(cid) ?? [];
    list.push({
      blockId: Number(b.BlockId),
      blockType: b.BlockType,
      startAt: fromSqlDateTime(b.StartAt),
      endAt: b.EndAt !== null ? fromSqlDateTime(b.EndAt) : null,
      reason: b.Reason,
    });
    blocksByCourt.set(cid, list);
  }

  const nowMs = now.getTime();

  return courts.map((c) => {
    const cid = Number(c.CourtId);
    const courtBlocks = blocksByCourt.get(cid) ?? [];
    const coveringNow = courtBlocks.filter(
      (b) => b.startAt.getTime() <= nowMs && (b.endAt === null || b.endAt.getTime() > nowMs),
    );
    const decommAny = courtBlocks.find((b) => b.blockType === 'DECOMMISSION');
    const decommNow = coveringNow.find((b) => b.blockType === 'DECOMMISSION');
    const maintNow = coveringNow.find((b) => b.blockType === 'MAINTENANCE');

    let displayStatus: CourtDisplayStatus;
    if (c.Status === 'INACTIVE') {
      displayStatus = decommAny ? 'DECOMMISSIONED' : 'INACTIVE';
    } else if (decommNow) {
      displayStatus = 'DECOMMISSIONED';
    } else if (maintNow) {
      displayStatus = 'MAINTENANCE';
    } else {
      displayStatus = 'ACTIVE';
    }

    const pickedBlock = decommNow ?? maintNow ?? (c.Status === 'INACTIVE' ? decommAny : undefined) ?? null;

    return {
      courtId: cid,
      code: c.Code,
      name: c.Name,
      branch: {
        branchId: Number(c.BranchId),
        name: c.BranchName,
      },
      sport: {
        sportId: Number(c.SportId),
        code: c.SportCode,
        name: c.SportName,
      },
      courtType: c.CourtType ?? null,
      description: c.Description ?? null,
      depositType: c.DepositType,
      depositValue: Number(c.DepositValue),
      status: c.Status,
      displayStatus,
      priceRules: rulesByCourt.get(cid) ?? [],
      activeBlock: pickedBlock
        ? {
            blockId: pickedBlock.blockId,
            blockType: pickedBlock.blockType,
            startAt: toIsoVn(pickedBlock.startAt),
            endAt: pickedBlock.endAt ? toIsoVn(pickedBlock.endAt) : null,
            reason: pickedBlock.reason,
          }
        : null,
    };
  });
}

@Injectable()
export class AdminCourtsRepository {
  async listCourts(
    exec: DbExecutor,
    filters: { branchId?: number; sportId?: number; status?: CourtStatus },
    now: Date,
  ): Promise<AdminCourtDto[]> {
    const req = exec.request();
    const where: string[] = [];
    if (filters.branchId !== undefined) {
      req.input('branchId', sql.Int, filters.branchId);
      where.push('c.BranchId = @branchId');
    }
    if (filters.sportId !== undefined) {
      req.input('sportId', sql.Int, filters.sportId);
      where.push('c.SportId = @sportId');
    }
    if (filters.status !== undefined) {
      req.input('status', sql.VarChar(20), filters.status);
      where.push('c.Status = @status');
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const courtsRes = await req.query<RawCourtRow>(`
      SELECT
        c.CourtId, c.Code, c.Name,
        c.BranchId, br.Name AS BranchName,
        c.SportId, sp.Code AS SportCode, sp.Name AS SportName,
        c.CourtType, c.Description, c.DepositType, c.DepositValue, c.Status
      FROM dbo.Courts c
      INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
      INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
      ${whereSql}
      ORDER BY c.BranchId ASC, c.SportId ASC, c.CourtId ASC
    `);

    const courtRows = courtsRes.recordset;
    if (courtRows.length === 0) {
      return [];
    }

    const courtIds = courtRows.map((c) => Number(c.CourtId));
    const rulesReq = exec.request().input('now', sql.DateTime2(0), toSqlDateTime(now));
    const rulesIn = buildIntInClause(courtIds, rulesReq, 'cid');
    const rulesRes = await rulesReq.query<RawPriceRuleRow>(`
      SELECT PriceRuleId, CourtId, Label, DayOfWeekMask, StartTime, EndTime, PricePerHour
      FROM dbo.CourtPriceRules
      WHERE CourtId IN (${rulesIn})
        AND EffectiveFrom <= @now
        AND (EffectiveTo IS NULL OR EffectiveTo > @now)
      ORDER BY CourtId ASC, DayOfWeekMask ASC, StartTime ASC, PriceRuleId ASC
    `);

    const blocksReq = exec.request().input('now', sql.DateTime2(0), toSqlDateTime(now));
    const blocksIn = buildIntInClause(courtIds, blocksReq, 'cid');
    const blocksRes = await blocksReq.query<RawBlockRow>(`
      SELECT BlockId, CourtId, BlockType, StartAt, EndAt, Reason
      FROM dbo.CourtBlocks
      WHERE CourtId IN (${blocksIn})
        AND ReleasedAt IS NULL
        AND (EndAt IS NULL OR EndAt > @now)
      ORDER BY BlockId DESC
    `);

    return mapCourtsWithRelations(courtRows, rulesRes.recordset, blocksRes.recordset, now);
  }

  async getCourtById(exec: DbExecutor, courtId: number, now: Date): Promise<AdminCourtDto | null> {
    const courtsRes = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .query<RawCourtRow>(`
        SELECT
          c.CourtId, c.Code, c.Name,
          c.BranchId, br.Name AS BranchName,
          c.SportId, sp.Code AS SportCode, sp.Name AS SportName,
          c.CourtType, c.Description, c.DepositType, c.DepositValue, c.Status
        FROM dbo.Courts c
        INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
        INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
        WHERE c.CourtId = @courtId
      `);

    const courtRow = courtsRes.recordset[0];
    if (!courtRow) {
      return null;
    }

    const rulesRes = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<RawPriceRuleRow>(`
        SELECT PriceRuleId, CourtId, Label, DayOfWeekMask, StartTime, EndTime, PricePerHour
        FROM dbo.CourtPriceRules
        WHERE CourtId = @courtId
          AND EffectiveFrom <= @now
          AND (EffectiveTo IS NULL OR EffectiveTo > @now)
        ORDER BY DayOfWeekMask ASC, StartTime ASC, PriceRuleId ASC
      `);

    const blocksRes = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<RawBlockRow>(`
        SELECT BlockId, CourtId, BlockType, StartAt, EndAt, Reason
        FROM dbo.CourtBlocks
        WHERE CourtId = @courtId
          AND ReleasedAt IS NULL
          AND (EndAt IS NULL OR EndAt > @now)
        ORDER BY BlockId DESC
      `);

    return mapCourtsWithRelations([courtRow], rulesRes.recordset, blocksRes.recordset, now)[0];
  }

  async hasOpenBookings(exec: DbExecutor, courtId: number): Promise<boolean> {
    const res = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .query<{ BookingId: number | string }>(`
        SELECT TOP 1 BookingId
        FROM dbo.Bookings
        WHERE CourtId = @courtId
          AND Status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_USE')
      `);
    return res.recordset.length > 0;
  }

  async findBranchById(
    exec: DbExecutor,
    branchId: number,
  ): Promise<{ branchId: number; name: string } | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{ BranchId: number; Name: string }>(`
        SELECT BranchId, Name FROM dbo.Branches WHERE BranchId = @branchId
      `);
    const row = res.recordset[0];
    if (!row) return null;
    return { branchId: Number(row.BranchId), name: row.Name };
  }

  async findActiveBranches(exec: DbExecutor): Promise<Array<{ branchId: number; name: string }>> {
    const res = await exec.request().query<{ BranchId: number; Name: string }>(`
      SELECT BranchId, Name
      FROM dbo.Branches
      WHERE Status = 'ACTIVE'
      ORDER BY BranchId ASC
    `);
    return res.recordset.map((r) => ({ branchId: Number(r.BranchId), name: r.Name }));
  }

  async findSportById(
    exec: DbExecutor,
    sportId: number,
  ): Promise<{ sportId: number; code: string; name: string } | null> {
    const res = await exec
      .request()
      .input('sportId', sql.Int, sportId)
      .query<{ SportId: number; Code: string; Name: string }>(`
        SELECT SportId, Code, Name FROM dbo.Sports WHERE SportId = @sportId
      `);
    const row = res.recordset[0];
    if (!row) return null;
    return { sportId: Number(row.SportId), code: row.Code, name: row.Name };
  }

  // R-06: SAN_{abbr}_{NN} with UPDLOCK, HOLDLOCK inside tx
  async generateNextCourtCode(tx: TxContext, sportCode: string): Promise<string> {
    const abbr = SPORT_ABBR_MAP[sportCode];
    if (!abbr) {
      throw new AppError('INTERNAL_ERROR', `Không có tiền tố mã sân cho bộ môn ${sportCode}.`);
    }
    const prefix = `SAN_${abbr}_`;
    const res = await tx
      .request()
      .input('pattern', sql.VarChar(30), `${prefix}%`)
      .query<{ Code: string }>(`
        SELECT Code
        FROM dbo.Courts WITH (UPDLOCK, HOLDLOCK)
        WHERE Code LIKE @pattern
      `);

    let maxSeq = 0;
    for (const row of res.recordset) {
      const suffix = row.Code.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        const num = Number.parseInt(suffix, 10);
        if (num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    const nextNum = maxSeq + 1;
    const seqStr = nextNum < 100 ? String(nextNum).padStart(2, '0') : String(nextNum);
    return `${prefix}${seqStr}`;
  }

  async insertCourt(
    tx: TxContext,
    input: {
      code: string;
      branchId: number;
      sportId: number;
      name: string;
      courtType: string | null;
      description: string | null;
      depositType: DepositType;
      depositValue: number;
      status: CourtStatus;
      now: Date;
    },
  ): Promise<number> {
    try {
      const res = await tx
        .request()
        .input('code', sql.VarChar(20), input.code)
        .input('branchId', sql.Int, input.branchId)
        .input('sportId', sql.Int, input.sportId)
        .input('name', sql.NVarChar(100), input.name)
        .input('courtType', sql.NVarChar(50), input.courtType)
        .input('description', sql.NVarChar(500), input.description)
        .input('depositType', sql.VarChar(10), input.depositType)
        .input('depositValue', sql.Decimal(18, 2), input.depositValue)
        .input('status', sql.VarChar(20), input.status)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query<{ CourtId: number }>(`
          INSERT INTO dbo.Courts (
            Code, BranchId, SportId, Name, CourtType, Description,
            DepositType, DepositValue, Status, CreatedAt, UpdatedAt
          )
          OUTPUT inserted.CourtId
          VALUES (
            @code, @branchId, @sportId, @name, @courtType, @description,
            @depositType, @depositValue, @status, @now, @now
          )
        `);
      return Number(res.recordset[0].CourtId);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async updateCourt(
    tx: TxContext,
    input: {
      courtId: number;
      branchId: number;
      name: string;
      courtType: string | null;
      description: string | null;
      depositType: DepositType;
      depositValue: number;
      status: CourtStatus;
      now: Date;
    },
  ): Promise<void> {
    try {
      await tx
        .request()
        .input('courtId', sql.Int, input.courtId)
        .input('branchId', sql.Int, input.branchId)
        .input('name', sql.NVarChar(100), input.name)
        .input('courtType', sql.NVarChar(50), input.courtType)
        .input('description', sql.NVarChar(500), input.description)
        .input('depositType', sql.VarChar(10), input.depositType)
        .input('depositValue', sql.Decimal(18, 2), input.depositValue)
        .input('status', sql.VarChar(20), input.status)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query(`
          UPDATE dbo.Courts
          SET BranchId = @branchId,
              Name = @name,
              CourtType = @courtType,
              Description = @description,
              DepositType = @depositType,
              DepositValue = @depositValue,
              Status = @status,
              UpdatedAt = @now
          WHERE CourtId = @courtId
        `);
    } catch (err) {
      mapSqlError(err);
    }
  }

  // FR 06: close existing active price rules rather than mutating prices in place
  async closeActivePriceRules(tx: TxContext, courtId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('courtId', sql.Int, courtId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.CourtPriceRules
        SET EffectiveFrom = CASE
              WHEN EffectiveFrom >= @now THEN DATEADD(SECOND, -1, @now)
              ELSE EffectiveFrom
            END,
            EffectiveTo = @now
        WHERE CourtId = @courtId
          AND EffectiveFrom <= @now
          AND (EffectiveTo IS NULL OR EffectiveTo > @now)
      `);
  }

  async insertPriceRules(
    tx: TxContext,
    courtId: number,
    rules: PriceRuleInputDto[],
    now: Date,
  ): Promise<void> {
    const sqlNow = toSqlDateTime(now);
    for (const rule of rules) {
      await tx
        .request()
        .input('courtId', sql.Int, courtId)
        .input('label', sql.NVarChar(50), rule.label.trim())
        .input('dayOfWeekMask', sql.TinyInt, rule.dayOfWeekMask)
        .input('startTime', sql.VarChar(8), toSqlTimeString(rule.startTime))
        .input('endTime', sql.VarChar(8), toSqlTimeString(rule.endTime))
        .input('pricePerHour', sql.Decimal(18, 0), Math.round(rule.pricePerHour))
        .input('effectiveFrom', sql.DateTime2(0), sqlNow)
        .query(`
          INSERT INTO dbo.CourtPriceRules (
            CourtId, Label, DayOfWeekMask, StartTime, EndTime, PricePerHour, EffectiveFrom, EffectiveTo
          )
          VALUES (
            @courtId, @label, @dayOfWeekMask, CAST(@startTime AS TIME(0)), CAST(@endTime AS TIME(0)),
            @pricePerHour, @effectiveFrom, NULL
          )
        `);
    }
  }

  async listCourtBlocks(
    exec: DbExecutor,
    filters: { branchId?: number; active: boolean },
    now: Date,
  ): Promise<AdminCourtBlockListItemDto[]> {
    const req = exec.request().input('now', sql.DateTime2(0), toSqlDateTime(now));
    const where: string[] = [];
    if (filters.branchId !== undefined) {
      req.input('branchId', sql.Int, filters.branchId);
      where.push('c.BranchId = @branchId');
    }
    if (filters.active) {
      where.push('cb.ReleasedAt IS NULL AND (cb.EndAt IS NULL OR cb.EndAt > @now)');
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const res = await req.query<{
      BlockId: number | string;
      CourtId: number;
      CourtCode: string;
      CourtName: string;
      BranchName: string;
      BlockType: BlockType;
      StartAt: Date | string;
      EndAt: Date | string | null;
      Reason: string;
      CreatedByName: string;
      CreatedAt: Date | string;
    }>(`
      SELECT
        cb.BlockId, cb.CourtId, c.Code AS CourtCode, c.Name AS CourtName,
        br.Name AS BranchName, cb.BlockType, cb.StartAt, cb.EndAt, cb.Reason,
        u.FullName AS CreatedByName, cb.CreatedAt
      FROM dbo.CourtBlocks cb
      INNER JOIN dbo.Courts c ON c.CourtId = cb.CourtId
      INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
      INNER JOIN dbo.Users u ON u.UserId = cb.CreatedBy
      ${whereSql}
      ORDER BY cb.StartAt ASC, cb.BlockId DESC
    `);

    return res.recordset.map((r) => ({
      blockId: Number(r.BlockId),
      court: {
        courtId: Number(r.CourtId),
        code: r.CourtCode,
        name: r.CourtName,
        branchName: r.BranchName,
      },
      blockType: r.BlockType,
      startAt: toIsoVn(fromSqlDateTime(r.StartAt)),
      endAt: r.EndAt !== null ? toIsoVn(fromSqlDateTime(r.EndAt)) : null,
      reason: r.Reason,
      createdByName: r.CreatedByName,
      createdAt: toIsoVn(fromSqlDateTime(r.CreatedAt)),
    }));
  }

  async hasOverlappingCourtBlock(
    tx: TxContext,
    courtId: number,
    startAt: Date,
    endAt: Date | null,
  ): Promise<boolean> {
    const req = tx
      .request()
      .input('courtId', sql.Int, courtId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt));

    let endCondition = '';
    if (endAt !== null) {
      req.input('endAt', sql.DateTime2(0), toSqlDateTime(endAt));
      endCondition = 'AND cb.StartAt < @endAt';
    }

    const res = await req.query<{ BlockId: number | string }>(`
      SELECT TOP 1 cb.BlockId
      FROM dbo.CourtBlocks cb WITH (UPDLOCK, HOLDLOCK)
      WHERE cb.CourtId = @courtId
        AND cb.ReleasedAt IS NULL
        AND (cb.EndAt IS NULL OR cb.EndAt > @startAt)
        ${endCondition}
    `);

    return res.recordset.length > 0;
  }

  async insertCourtBlock(
    tx: TxContext,
    input: {
      courtId: number;
      blockType: BlockType;
      startAt: Date;
      endAt: Date | null;
      reason: string;
      createdBy: number;
      now: Date;
    },
  ): Promise<number> {
    const res = await tx
      .request()
      .input('courtId', sql.Int, input.courtId)
      .input('blockType', sql.VarChar(20), input.blockType)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(input.startAt))
      .input('endAt', sql.DateTime2(0), input.endAt ? toSqlDateTime(input.endAt) : null)
      .input('reason', sql.NVarChar(255), input.reason)
      .input('createdBy', sql.BigInt, input.createdBy)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
      .query<{ BlockId: number | string }>(`
        INSERT INTO dbo.CourtBlocks (
          CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy, CreatedAt
        )
        OUTPUT inserted.BlockId
        VALUES (
          @courtId, @blockType, @startAt, @endAt, @reason, @createdBy, @now
        )
      `);

    return Number(res.recordset[0].BlockId);
  }

  async findBlockById(exec: DbExecutor | TxContext, blockId: number): Promise<CourtBlockRecord | null> {
    const lockHint = 'isTransaction' in exec ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const res = await exec
      .request()
      .input('blockId', sql.BigInt, blockId)
      .query<{
        BlockId: number | string;
        CourtId: number;
        BranchId: number;
        BlockType: BlockType;
        StartAt: Date | string;
        EndAt: Date | string | null;
        Reason: string;
        ReleasedAt: Date | string | null;
      }>(`
        SELECT cb.BlockId, cb.CourtId, c.BranchId, cb.BlockType, cb.StartAt, cb.EndAt, cb.Reason, cb.ReleasedAt
        FROM dbo.CourtBlocks cb ${lockHint}
        INNER JOIN dbo.Courts c ON c.CourtId = cb.CourtId
        WHERE cb.BlockId = @blockId
      `);

    const r = res.recordset[0];
    if (!r) return null;
    return {
      blockId: Number(r.BlockId),
      courtId: Number(r.CourtId),
      branchId: Number(r.BranchId),
      blockType: r.BlockType,
      startAt: fromSqlDateTime(r.StartAt),
      endAt: r.EndAt !== null ? fromSqlDateTime(r.EndAt) : null,
      reason: r.Reason,
      releasedAt: r.ReleasedAt !== null ? fromSqlDateTime(r.ReleasedAt) : null,
    };
  }

  async releaseCourtBlock(
    tx: TxContext,
    blockId: number,
    releasedBy: number,
    now: Date,
  ): Promise<string> {
    await tx
      .request()
      .input('blockId', sql.BigInt, blockId)
      .input('releasedBy', sql.BigInt, releasedBy)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.CourtBlocks
        SET ReleasedAt = @now,
            ReleasedBy = @releasedBy
        WHERE BlockId = @blockId
          AND ReleasedAt IS NULL
      `);

    const userRes = await tx
      .request()
      .input('userId', sql.BigInt, releasedBy)
      .query<{ FullName: string }>(`SELECT FullName FROM dbo.Users WHERE UserId = @userId`);

    return userRes.recordset[0]?.FullName ?? '';
  }

  async getOpeningHours(exec: DbExecutor, branchId: number): Promise<OpeningHoursDayDto[]> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{
        DayOfWeek: number;
        OpenTime: Date | string | null;
        CloseTime: Date | string | null;
        IsClosed: boolean | number;
      }>(`
        SELECT DayOfWeek, OpenTime, CloseTime, IsClosed
        FROM dbo.BranchOpeningHours
        WHERE BranchId = @branchId
        ORDER BY DayOfWeek ASC
      `);

    return res.recordset.map((r) => {
      const isClosed = Boolean(r.IsClosed);
      return {
        dayOfWeek: Number(r.DayOfWeek),
        openTime: isClosed || r.OpenTime === null ? null : fromSqlTime(r.OpenTime),
        closeTime: isClosed || r.CloseTime === null ? null : fromSqlTime(r.CloseTime),
        isClosed,
      };
    });
  }

  async replaceOpeningHours(
    tx: TxContext,
    branchId: number,
    days: OpeningHoursDayDto[],
  ): Promise<void> {
    await tx
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`DELETE FROM dbo.BranchOpeningHours WHERE BranchId = @branchId`);

    for (const day of days) {
      await tx
        .request()
        .input('branchId', sql.Int, branchId)
        .input('dayOfWeek', sql.TinyInt, day.dayOfWeek)
        .input('openTime', sql.VarChar(8), day.isClosed || !day.openTime ? null : toSqlTimeString(day.openTime))
        .input('closeTime', sql.VarChar(8), day.isClosed || !day.closeTime ? null : toSqlTimeString(day.closeTime))
        .input('isClosed', sql.Bit, day.isClosed ? 1 : 0)
        .query(`
          INSERT INTO dbo.BranchOpeningHours (BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed)
          VALUES (
            @branchId,
            @dayOfWeek,
            CASE WHEN @openTime IS NULL THEN NULL ELSE CAST(@openTime AS TIME(0)) END,
            CASE WHEN @closeTime IS NULL THEN NULL ELSE CAST(@closeTime AS TIME(0)) END,
            @isClosed
          )
        `);
    }
  }

  async listHolidays(
    exec: DbExecutor,
    filters: { branchId?: number; from: string },
  ): Promise<AdminHolidayDto[]> {
    const req = exec.request().input('from', sql.Date, toSqlDate(filters.from));
    let branchSql = '';
    if (filters.branchId !== undefined) {
      req.input('branchId', sql.Int, filters.branchId);
      branchSql = 'AND h.BranchId = @branchId';
    }

    const res = await req.query<{
      HolidayId: number;
      BranchId: number;
      BranchName: string;
      StartDate: Date | string;
      EndDate: Date | string;
      Reason: string | null;
      GroupKey: string | null;
    }>(`
      SELECT
        h.HolidayId, h.BranchId, br.Name AS BranchName,
        h.StartDate, h.EndDate, h.Reason, h.GroupKey
      FROM dbo.BranchHolidays h
      INNER JOIN dbo.Branches br ON br.BranchId = h.BranchId
      WHERE h.EndDate >= @from
        ${branchSql}
      ORDER BY h.StartDate ASC, h.HolidayId ASC
    `);

    return res.recordset.map((r) => ({
      holidayId: Number(r.HolidayId),
      branch: {
        branchId: Number(r.BranchId),
        name: r.BranchName,
      },
      startDate: fromSqlDate(r.StartDate),
      endDate: fromSqlDate(r.EndDate),
      reason: r.Reason ?? null,
      groupKey: r.GroupKey ?? null,
    }));
  }

  async generateNextHolidayGroupKey(tx: TxContext, startDate: string): Promise<string> {
    const compact = startDate.replace(/-/g, '');
    const prefix = `H-${compact}-`;
    const res = await tx
      .request()
      .input('pattern', sql.VarChar(30), `${prefix}%`)
      .query<{ GroupKey: string }>(`
        SELECT DISTINCT GroupKey
        FROM dbo.BranchHolidays WITH (UPDLOCK, HOLDLOCK)
        WHERE GroupKey LIKE @pattern
      `);

    let maxSeq = 0;
    for (const row of res.recordset) {
      const suffix = row.GroupKey.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        const num = Number.parseInt(suffix, 10);
        if (num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    return `${prefix}${maxSeq + 1}`;
  }

  async insertHolidays(
    tx: TxContext,
    input: {
      branchIds: number[];
      startDate: string;
      endDate: string;
      reason: string;
      groupKey: string | null;
      createdBy: number;
      now: Date;
    },
  ): Promise<Array<{ holidayId: number; branchId: number }>> {
    const inserted: Array<{ holidayId: number; branchId: number }> = [];
    const sqlStart = toSqlDate(input.startDate);
    const sqlEnd = toSqlDate(input.endDate);
    const sqlNow = toSqlDateTime(input.now);

    for (const branchId of input.branchIds) {
      const res = await tx
        .request()
        .input('branchId', sql.Int, branchId)
        .input('startDate', sql.Date, sqlStart)
        .input('endDate', sql.Date, sqlEnd)
        .input('reason', sql.NVarChar(255), input.reason)
        .input('createdBy', sql.BigInt, input.createdBy)
        .input('createdAt', sql.DateTime2(0), sqlNow)
        .input('groupKey', sql.VarChar(30), input.groupKey)
        .query<{ HolidayId: number; BranchId: number }>(`
          INSERT INTO dbo.BranchHolidays (
            BranchId, StartDate, EndDate, Reason, CreatedBy, CreatedAt, GroupKey
          )
          OUTPUT inserted.HolidayId, inserted.BranchId
          VALUES (
            @branchId, @startDate, @endDate, @reason, @createdBy, @createdAt, @groupKey
          )
        `);
      inserted.push({
        holidayId: Number(res.recordset[0].HolidayId),
        branchId: Number(res.recordset[0].BranchId),
      });
    }

    return inserted;
  }

  async findHolidayById(tx: TxContext, holidayId: number): Promise<HolidayRecord | null> {
    const res = await tx
      .request()
      .input('holidayId', sql.Int, holidayId)
      .query<{
        HolidayId: number;
        BranchId: number;
        StartDate: Date | string;
        EndDate: Date | string;
        Reason: string | null;
        GroupKey: string | null;
      }>(`
        SELECT HolidayId, BranchId, StartDate, EndDate, Reason, GroupKey
        FROM dbo.BranchHolidays WITH (UPDLOCK, ROWLOCK)
        WHERE HolidayId = @holidayId
      `);

    const r = res.recordset[0];
    if (!r) return null;
    return {
      holidayId: Number(r.HolidayId),
      branchId: Number(r.BranchId),
      startDate: fromSqlDate(r.StartDate),
      endDate: fromSqlDate(r.EndDate),
      reason: r.Reason ?? null,
      groupKey: r.GroupKey ?? null,
    };
  }

  async findHolidaysByGroupKey(tx: TxContext, groupKey: string): Promise<HolidayRecord[]> {
    const res = await tx
      .request()
      .input('groupKey', sql.VarChar(30), groupKey)
      .query<{
        HolidayId: number;
        BranchId: number;
        StartDate: Date | string;
        EndDate: Date | string;
        Reason: string | null;
        GroupKey: string | null;
      }>(`
        SELECT HolidayId, BranchId, StartDate, EndDate, Reason, GroupKey
        FROM dbo.BranchHolidays WITH (UPDLOCK, ROWLOCK)
        WHERE GroupKey = @groupKey
        ORDER BY HolidayId ASC
      `);

    return res.recordset.map((r) => ({
      holidayId: Number(r.HolidayId),
      branchId: Number(r.BranchId),
      startDate: fromSqlDate(r.StartDate),
      endDate: fromSqlDate(r.EndDate),
      reason: r.Reason ?? null,
      groupKey: r.GroupKey ?? null,
    }));
  }

  async deleteHolidayById(tx: TxContext, holidayId: number): Promise<void> {
    await tx
      .request()
      .input('holidayId', sql.Int, holidayId)
      .query(`DELETE FROM dbo.BranchHolidays WHERE HolidayId = @holidayId`);
  }

  async deleteHolidaysByGroupKey(tx: TxContext, groupKey: string): Promise<void> {
    await tx
      .request()
      .input('groupKey', sql.VarChar(30), groupKey)
      .query(`DELETE FROM dbo.BranchHolidays WHERE GroupKey = @groupKey`);
  }
}
