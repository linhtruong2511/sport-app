import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useBranchSportSummary,
  useBranchesWithMeta,
  useSports,
  type BranchSportHoliday,
  type SportListItem,
} from '../api/catalog.ts';
import { usePublicPromotions } from '../api/promotions.ts';
import {
  extractErrorMessage,
  formatDepositRule,
  formatPromoSummary,
  money,
  todayVn,
  toVN,
} from '../utils/format.ts';

const PROMO_TONES = ['b-green', 'b-sky', 'b-indigo', 'b-amber'] as const;

const SPORT_FALLBACK_ICONS: Record<string, string> = {
  PICKLEBALL: '🏓',
  BADMINTON: '🏸',
  FOOTBALL: '⚽',
  TENNIS: '🎾',
};

function sportIconOf(sport: SportListItem): string {
  if (sport.icon && sport.icon.trim()) {
    return sport.icon;
  }
  return SPORT_FALLBACK_ICONS[sport.code.toUpperCase()] ?? '🏟️';
}

function getHolidayText(holiday: BranchSportHoliday | null | undefined): string | null {
  if (!holiday) return null;
  const record = holiday as BranchSportHoliday & { reason?: string | null };
  return record.reason || record.note || record.name || 'Ngày nghỉ lễ';
}

export default function Home() {
  const nav = useNavigate();
  const today = todayVn();

  const branchesQ = useBranchesWithMeta({ status: 'ACTIVE' });
  const sportsQ = useSports();
  const promotionsQ = usePublicPromotions({ limit: 3 });

  const branches = branchesQ.data?.items ?? [];
  const totalCourts = branchesQ.data?.totalCourts ?? 0;
  const sports = sportsQ.data ?? [];
  const promotions = promotionsQ.data ?? [];

  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [selectedSportId, setSelectedSportId] = useState<number | null>(null);
  const [date, setDate] = useState<string>(today);
  const [selectedFocusBranchId, setSelectedFocusBranchId] = useState<number | null>(null);

  const effectiveBranchId = selectedBranchId ?? branches[0]?.branchId ?? null;
  const effectiveSportId = selectedSportId ?? sports[0]?.sportId ?? null;
  const focusBranchId = selectedFocusBranchId ?? branches[0]?.branchId ?? null;

  const summaryQ = useBranchSportSummary(focusBranchId, { date: today });
  const summary = summaryQ.data;

  const go = (params: Record<string, string>) => {
    nav(`/booking?${new URLSearchParams(params).toString()}`);
  };

  const handleSearch = () => {
    const query: Record<string, string> = { date: date || today };
    if (effectiveBranchId) query.branchId = String(effectiveBranchId);
    if (effectiveSportId) query.sportId = String(effectiveSportId);
    go(query);
  };

  const holidayText = getHolidayText(summary?.branch.holiday);

  return (
    <>
      {/* Hero + khung tìm kiếm */}
      <section className="hero col g20" style={{ padding: '32px 32px 28px' }}>
        <span
          className="badge"
          style={{
            alignSelf: 'flex-start',
            background: 'rgba(4,120,87,.8)',
            border: '1px solid rgba(16,185,129,.4)',
            color: 'var(--brand-100)',
          }}
        >
          ⚡ Hệ thống {branches.length} Chi nhánh • {totalCourts} Sân tiêu chuẩn thi đấu
        </span>
        <h1 style={{ fontSize: 32, lineHeight: '40px', fontWeight: 800, maxWidth: 700, letterSpacing: -0.4 }}>
          Tìm sân nhanh, xem giờ trống trực tiếp & giữ sân chỉ trong 1 phút
        </h1>
        <p className="t14" style={{ maxWidth: 720, color: 'var(--brand-100)', lineHeight: '22.75px' }}>
          Không cần gọi điện chờ đợi. Chọn khung giờ yêu thích trên bảng lịch, thanh toán trọn gói
          hoặc đặt cọc giữ chỗ qua mã QR và nhận thông báo nhắc lịch trước giờ chơi.
        </p>
        <div className="search-card" style={{ gridTemplateColumns: 'repeat(3, 1fr) auto' }}>
          <div>
            <label className="label" htmlFor="home-branch">
              Chi nhánh
            </label>
            <select
              id="home-branch"
              className="select"
              value={effectiveBranchId ?? ''}
              disabled={branchesQ.isLoading || branches.length === 0}
              onChange={(e) => setSelectedBranchId(Number(e.target.value) || null)}
            >
              {branches.length === 0 ? (
                <option value="">Đang tải chi nhánh...</option>
              ) : (
                branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="home-sport">
              Bộ môn thể thao
            </label>
            <select
              id="home-sport"
              className="select"
              value={effectiveSportId ?? ''}
              disabled={sportsQ.isLoading || sports.length === 0}
              onChange={(e) => setSelectedSportId(Number(e.target.value) || null)}
            >
              {sports.length === 0 ? (
                <option value="">Đang tải bộ môn...</option>
              ) : (
                sports.map((s) => (
                  <option key={s.sportId} value={s.sportId}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="home-date">
              Ngày chơi
            </label>
            <input
              id="home-date"
              className="input"
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value || today)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            style={{ height: 44 }}
            disabled={!effectiveBranchId || !effectiveSportId}
            onClick={handleSearch}
          >
            Tìm sân trống ngay →
          </button>
        </div>
        <div className="row g8 wrap">
          <span className="t12 w700" style={{ color: 'var(--brand-100)' }}>
            Bộ môn phổ biến:
          </span>
          {sports.map((s) => (
            <button
              type="button"
              key={s.sportId}
              className={`sport-chip${effectiveSportId === s.sportId ? ' on' : ''}`}
              onClick={() => setSelectedSportId(s.sportId)}
            >
              {sportIconOf(s)} {s.name} ({s.activeCourtCount} sân)
            </button>
          ))}
        </div>
      </section>

      {/* Khuyến mãi */}
      <section className="col g12">
        <div className="row between">
          <div className="col g2">
            <h2 className="t18 w800 c-ink">Mã ưu đãi dành cho bạn</h2>
            <p className="t12 c-s600">
              Dùng mã giảm giá ở bước đặt sân để tiết kiệm chi phí thuê sân.
            </p>
          </div>
          <button type="button" className="link-btn" onClick={() => nav('/booking')}>
            Đặt sân & dùng mã →
          </button>
        </div>
        <div className="row g16" style={{ alignItems: 'stretch' }}>
          {promotionsQ.isLoading && (
            <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>
              Đang tải chương trình ưu đãi...
            </div>
          )}
          {promotionsQ.isError && (
            <div className="hint f1" style={{ textAlign: 'center', padding: 24, color: 'var(--rose-700)' }}>
              {extractErrorMessage(promotionsQ.error, 'Không thể tải danh sách ưu đãi.')}
            </div>
          )}
          {!promotionsQ.isLoading && !promotionsQ.isError && promotions.length === 0 && (
            <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>
              Hiện chưa có chương trình ưu đãi nào đang chạy.
            </div>
          )}
          {promotions.slice(0, 3).map((p, i) => (
            <div key={p.code} className={`promo-card f1${i === 0 ? ' first' : ''}`}>
              <div className="row between g12">
                <span
                  className={`badge sq ${PROMO_TONES[i % PROMO_TONES.length]}`}
                  style={{ padding: '2px 10px', fontSize: 11 }}
                >
                  {p.audienceType === 'SPECIFIC' ? 'Ưu đãi hội viên' : p.name}
                </span>
                <span className="code-chip">{p.code}</span>
              </div>
              <h3 className="t14 w800 c-ink" style={{ marginTop: 4 }}>
                Giảm {formatPromoSummary(p.discountType, p.discountValue, p.maxDiscountAmount)}
                {p.timeFrom && p.timeTo
                  ? ` khung ${p.timeFrom} - ${p.timeTo}`
                  : ' tất cả khung giờ'}
              </h3>
              <p className="t12 c-s600">
                {p.scopeText} • HSD: {toVN(p.endDate)}
              </p>
              <div className="row between" style={{ marginTop: 'auto' }}>
                <span />
                <button type="button" className="link-btn" onClick={() => go({ promo: p.code })}>
                  Dùng ngay
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cụm sân & chi nhánh */}
      <section className="grid12">
        <div className="span8 col g16">
          <div className="row between wrap g8">
            <h2 className="t18 w800 c-ink">Các cụm sân đang mở nhận lịch hôm nay</h2>
            <span className="t12 w600 c-s600">Giá thuê hiển thị theo bảng giá từng sân</span>
          </div>
          {holidayText && (
            <div
              className="hint"
              style={{
                background: 'var(--amber-50)',
                borderColor: 'var(--amber-300)',
                color: 'var(--amber-900)',
              }}
            >
              📅 Hôm nay ({toVN(today)}) chi nhánh nghỉ lễ: {holidayText}.
            </div>
          )}
          <div className="row wrap g16" style={{ alignItems: 'stretch' }}>
            {summaryQ.isLoading && (
              <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>
                Đang tải thông tin cụm sân...
              </div>
            )}
            {summaryQ.isError && (
              <div
                className="hint f1"
                style={{ textAlign: 'center', padding: 24, color: 'var(--rose-700)' }}
              >
                {extractErrorMessage(summaryQ.error, 'Không thể tải thông tin cụm sân.')}
              </div>
            )}
            {summary &&
              summary.sports.map((sp) => {
                const free = sp.freeSlotCount;
                const branchOpenText = summary.branch.holiday
                  ? 'Nghỉ lễ'
                  : summary.branch.isClosed ||
                      !summary.branch.openTime ||
                      !summary.branch.closeTime
                    ? 'Đóng cửa'
                    : `${summary.branch.openTime} – ${summary.branch.closeTime}`;
                const priceText =
                  sp.minPricePerHour !== null && sp.maxPricePerHour !== null
                    ? sp.minPricePerHour === sp.maxPricePerHour
                      ? `${money(sp.minPricePerHour)}/h`
                      : `${money(sp.minPricePerHour)} - ${money(sp.maxPricePerHour)}/h`
                    : 'Đang cập nhật';
                const depositText = sp.deposit
                  ? formatDepositRule(sp.deposit.type, sp.deposit.value)
                  : formatDepositRule(null, null);

                return (
                  <div key={sp.sportId} className="cluster" style={{ width: 'calc(50% - 8px)' }}>
                    <div className="cluster-body">
                      <div className="row between g8">
                        <span
                          className="badge sq b-green"
                          style={{ padding: '2px 10px', fontSize: 11 }}
                        >
                          {summary.branch.name}
                        </span>
                        <span
                          className={`badge ${free > 0 ? 'b-green-flat' : 'b-gray-o'}`}
                          style={{ padding: '2px 10px', fontSize: 11 }}
                        >
                          {free > 0
                            ? `● Còn ${free} khung giờ trống`
                            : '● Hết khung giờ trống'}
                        </span>
                      </div>
                      <h3 className="t16 w800 c-ink">
                        Cụm sân {sp.name} ({sp.courtCount} sân)
                      </h3>
                      <p className="t12 c-s600">📍 {summary.branch.address}</p>
                      <div className="row g24" style={{ marginTop: 4 }}>
                        <div className="col">
                          <span className="t11 c-s500">Giờ mở cửa hôm nay:</span>
                          <b className="t12 c-ink w800">{branchOpenText}</b>
                        </div>
                        <div className="col">
                          <span className="t11 c-s500">Giá thuê sân:</span>
                          <b className="t12 c-brand w800">{priceText}</b>
                        </div>
                      </div>
                    </div>
                    <div className="cluster-foot">
                      <span>Cọc từ {depositText}</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() =>
                          go({
                            branchId: String(summary.branch.branchId),
                            sportId: String(sp.sportId),
                            date: today,
                          })
                        }
                      >
                        Chọn giờ đặt
                      </button>
                    </div>
                  </div>
                );
              })}
            {!summaryQ.isLoading &&
              !summaryQ.isError &&
              summary &&
              summary.sports.length === 0 && (
                <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>
                  Chi nhánh này hiện chưa có sân đang hoạt động.
                </div>
              )}
          </div>
        </div>

        <aside className="span4 col g16">
          <div className="card col g12">
            <div className="row between">
              <h3 className="t14 w800 c-ink">Hệ thống chi nhánh SportHub</h3>
              <span className="t11 w700 c-brand">Đang hoạt động</span>
            </div>
            {branchesQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center' }}>
                Đang tải chi nhánh...
              </div>
            )}
            {branchesQ.isError && (
              <div className="hint" style={{ color: 'var(--rose-700)' }}>
                {extractErrorMessage(branchesQ.error, 'Không thể tải danh sách chi nhánh.')}
              </div>
            )}
            {branches.map((b) => (
              <button
                type="button"
                key={b.branchId}
                className={`branch-card${focusBranchId === b.branchId ? ' on' : ''}`}
                onClick={() => {
                  setSelectedFocusBranchId(b.branchId);
                  setSelectedBranchId(b.branchId);
                }}
              >
                <div className="row between">
                  <span className="t12 w800 c-ink">📍 {b.name}</span>
                  <span className="t12 w700 c-s800">{b.courtCount} sân</span>
                </div>
                <div className="t11 c-s600" style={{ marginTop: 2 }}>
                  {b.address.split(',')[0]}
                  {b.phone ? ` • SĐT: ${b.phone}` : ''}
                </div>
              </button>
            ))}
          </div>
          <div className="card col g12">
            <h3 className="t14 w800 c-ink">Hướng dẫn đặt lịch nhanh</h3>
            {[
              [
                'Chọn khung giờ trống:',
                'Nhấp trực tiếp vào ô giờ còn trống trên bảng lịch của cơ sở (có thể chọn nhiều khung liền kề).',
              ],
              [
                'Thanh toán đủ hoặc đặt cọc:',
                'Quét mã VietQR để giữ sân ngay lập tức mà không cần chờ duyệt.',
              ],
              [
                'Nhận sân đúng giờ:',
                'Hệ thống gửi thông báo nhắc lịch trước 1 tiếng. Lưu ý tiền đặt cọc không được hoàn lại khi hủy đơn hoặc quá giờ không đến nhận sân.',
              ],
            ].map(([title, desc], i) => (
              <div className="row g12" key={title} style={{ alignItems: 'flex-start' }}>
                <span className="step-no">{i + 1}</span>
                <p className="t12 c-s700" style={{ lineHeight: '19px' }}>
                  <b className="c-ink">{title}</b> {desc}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </>
  );
}
