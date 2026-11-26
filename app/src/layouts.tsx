import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useOutletContext,
} from 'react-router-dom';
import type { UserRole } from '@sporthub/shared';
import { useBranches, type BranchListItem } from './api/catalog.ts';
import { useUnreadNotificationsCount } from './api/notifications.ts';
import { subscribeRoom, unsubscribeRoom } from './api/socket.ts';
import bell from './assets/icons/bell.svg';
import iBookingA from './assets/icons/nav-booking-active.svg';
import iBooking from './assets/icons/nav-booking.svg';
import iCourtsA from './assets/icons/nav-courts-active.svg';
import iCourts from './assets/icons/nav-courts.svg';
import iExit from './assets/icons/nav-exit.svg';
import iOrdersA from './assets/icons/nav-orders-active.svg';
import iOrders from './assets/icons/nav-orders.svg';
import iPromoA from './assets/icons/nav-promo-active.svg';
import iPromo from './assets/icons/nav-promo.svg';
import iSettingsA from './assets/icons/nav-settings-active.svg';
import iSettings from './assets/icons/nav-settings.svg';
import iStaffA from './assets/icons/nav-staff-active.svg';
import iStaff from './assets/icons/nav-staff.svg';
import iStatsA from './assets/icons/nav-stats-active.svg';
import iStats from './assets/icons/nav-stats.svg';
import { useAuth } from './auth/authContext.ts';
import { dow, homeOf, initials, todayVn, toVN } from './utils/format.ts';

const ROLE_RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  STAFF: 1,
  OWNER: 2,
};

/** Chặn truy cập theo vai trò. Vai trò sau kế thừa giao diện của vai trò trước. */
export function Guard({ min }: { min: UserRole }) {
  const { user, isBootstrapping, skipReturnRedirect } = useAuth();
  const loc = useLocation();
  const ctx = useOutletContext();

  if (isBootstrapping) {
    return (
      <div className="center" style={{ minHeight: '60vh' }}>
        <span className="t14 c-s600">Đang kiểm tra phiên đăng nhập...</span>
      </div>
    );
  }

  if (!user) {
    // Nếu vừa đăng xuất / bị thu hồi phiên, không giữ `from` kẻo chuyển nhầm user kế tiếp
    const state = skipReturnRedirect ? undefined : { from: loc.pathname + loc.search };
    return <Navigate to="/login" replace state={state} />;
  }

  if (ROLE_RANK[user.role] < ROLE_RANK[min]) {
    return <Navigate to={homeOf(user.role)} replace />;
  }

  return <Outlet context={ctx} />;
}

/** Giao diện khách hàng — Trang chủ & Đặt sân mở công khai cho khách chưa đăng nhập. */
export function CustomerLayout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const currentLocKey = `${loc.pathname}${loc.search}`;
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const menuOpen = openMenuKey === currentLocKey;
  const unreadQ = useUnreadNotificationsCount({ enabled: user !== null });
  const unreadCount = unreadQ.data?.unreadCount ?? 0;

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 901px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpenMenuKey(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuKey(null);
    };
    mql.addEventListener('change', onChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const cls = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`;
  const mobileCls = ({ isActive }: { isActive: boolean }) =>
    `mobile-nav-link${isActive ? ' active' : ''}`;

  const handleLogout = async () => {
    setOpenMenuKey(null);
    await logout();
  };

  return (
    <div className="col" style={{ minHeight: '100vh' }}>
      <header className="hdr">
        <div className="container hdr-in">
          <div className="hdr-left">
            <Link to="/" className="row g10" style={{ minWidth: 0 }}>
              <div className="logo-mark">
                <img src="/logo-88-sports-transparent-256x256.png" alt="Logo Thể thao 88" />
              </div>
              <div className="col g4" style={{ paddingBottom: 2, minWidth: 0 }}>
                <span className="logo-name">Thể thao 88</span>
                <span className="logo-sub nowrap">Đặt sân thể thao trực tuyến</span>
              </div>
            </Link>
            <nav className="hdr-nav" aria-label="Điều hướng chính">
              <NavLink to="/" end className={cls}>
                Trang chủ
              </NavLink>
              <NavLink to="/booking" className={cls}>
                Đặt sân trực tuyến
              </NavLink>
              <NavLink to="/my-bookings" className={cls}>
                Lịch đặt của tôi
              </NavLink>
            </nav>
          </div>
          <div className="hdr-right">
            {user && (
              <Link to="/my-bookings" className="bell" aria-label="Thông báo" title="Thông báo">
                <img src={bell} alt="" width={20} height={20} />
                {unreadCount > 0 && (
                  <span
                    className="dot"
                    data-testid="nav-unread-count"
                    title={`${unreadCount} thông báo chưa đọc`}
                  />
                )}
              </Link>
            )}
            {user ? (
              <div className="hdr-user-desktop">
                <div className="user-box">
                  <div className="avatar">{initials(user.fullName)}</div>
                  <div className="col right">
                    <span className="t12 w700 c-ink nowrap">{user.fullName}</span>
                    <span className="t11 w500 c-brand nowrap">{user.title}</span>
                  </div>
                  {user.role !== 'CUSTOMER' && (
                    <Link
                      to={homeOf(user.role)}
                      className="btn btn-outline btn-sm"
                      style={{ marginLeft: 4 }}
                    >
                      ← Về quản lý
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ marginLeft: 4, fontWeight: 600 }}
                    onClick={() => void handleLogout()}
                  >
                    Đăng xuất
                  </button>
                </div>
              </div>
            ) : (
              <div className="hdr-user-desktop row g8">
                <Link to="/login" className="btn btn-outline btn-md">
                  Đăng nhập
                </Link>
                <Link to="/login" state={{ tab: 'register' }} className="btn btn-primary btn-md">
                  Đăng ký
                </Link>
              </div>
            )}
            <div className="hdr-mobile-actions">
              {!user && (
                <Link to="/login" className="btn btn-primary btn-sm">
                  Đăng nhập
                </Link>
              )}
              <button
                type="button"
                className="hdr-burger"
                aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
                aria-expanded={menuOpen}
                onClick={() =>
                  setOpenMenuKey((prev) => (prev === currentLocKey ? null : currentLocKey))
                }
              >
                {menuOpen ? '✕' : '☰'}
              </button>
            </div>
          </div>
        </div>
        {menuOpen && (
          <div className="mobile-nav open">
            <nav className="mobile-nav-links" aria-label="Menu di động">
              <NavLink
                to="/"
                end
                className={mobileCls}
                onClick={() => setOpenMenuKey(null)}
              >
                Trang chủ
              </NavLink>
              <NavLink
                to="/booking"
                className={mobileCls}
                onClick={() => setOpenMenuKey(null)}
              >
                Đặt sân trực tuyến
              </NavLink>
              <NavLink
                to="/my-bookings"
                className={mobileCls}
                onClick={() => setOpenMenuKey(null)}
              >
                Lịch đặt của tôi
              </NavLink>
            </nav>
            <div className="top-rule col g10">
              {user ? (
                <>
                  <div className="row between g10">
                    <div className="row g10" style={{ minWidth: 0 }}>
                      <div className="avatar">{initials(user.fullName)}</div>
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="t12 w700 c-ink break-word">{user.fullName}</span>
                        <span className="t11 w500 c-brand">{user.title}</span>
                      </div>
                    </div>
                  </div>
                  <div className="row g8 wrap">
                    {user.role !== 'CUSTOMER' && (
                      <Link
                        to={homeOf(user.role)}
                        className="btn btn-outline btn-md f1"
                        onClick={() => setOpenMenuKey(null)}
                      >
                        ← Về quản lý
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline btn-md f1"
                      onClick={() => void handleLogout()}
                    >
                      Đăng xuất
                    </button>
                  </div>
                </>
              ) : (
                <div className="row g8">
                  <Link
                    to="/login"
                    className="btn btn-outline btn-md f1"
                    onClick={() => setOpenMenuKey(null)}
                  >
                    Đăng nhập
                  </Link>
                  <Link
                    to="/login"
                    state={{ tab: 'register' }}
                    className="btn btn-primary btn-md f1"
                    onClick={() => setOpenMenuKey(null)}
                  >
                    Đăng ký
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="container col g24 customer-main">
        <Outlet />
      </main>
    </div>
  );
}

function SideItem({
  to,
  label,
  icon,
  iconActive,
}: {
  to: string;
  label: string;
  icon: string;
  iconActive: string;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}>
      {({ isActive }) => (
        <>
          <img src={isActive ? iconActive : icon} alt="" />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

const META: Record<string, { title: string; desc: string }> = {
  '/staff/booking': {
    title: 'Đặt sân tại quầy & Thu ngân',
    desc: 'Lập đơn nhanh cho khách vãng lai hoặc khách có tài khoản, áp dụng khuyến mãi và thu tiền trực tiếp',
  },
  '/staff/orders': {
    title: 'Quản lý đơn đặt & Bàn giao sân',
    desc: 'Tra cứu lịch đặt của khách, thu nốt tiền còn thiếu khi nhận sân và cập nhật trạng thái sân',
  },
  '/staff/stats': {
    title: 'Tổng quan vận hành & Doanh thu trong ngày',
    desc: 'Theo dõi nhanh tình trạng lấp đầy sân, các đơn sắp nhận sân và tổng tiền thực thu trong ca trực',
  },
  '/staff/reconciliation': {
    title: 'Đối soát giao dịch chuyển khoản',
    desc: 'Xử lý các giao dịch chuyển khoản sai tiền, sai nội dung hoặc trễ hạn tại cơ sở',
  },
  '/owner/staff': {
    title: 'Quản lý đội ngũ nhân viên',
    desc: 'Phân công nhân viên theo từng chi nhánh, cấp mới hoặc khóa tài khoản nhân sự nghỉ việc',
  },
  '/owner/courts': {
    title: 'Quản lý sân bãi, Bảng giá & Lịch bảo trì',
    desc: 'Thêm sân mới, điều chỉnh đơn giá thuê theo khung giờ, cài đặt giờ mở cửa và tạm khóa sân bảo trì',
  },
  '/owner/reports': {
    title: 'Quản lý Khuyến mãi & Báo cáo doanh thu chuyên sâu',
    desc: 'Thống kê doanh thu thực thu theo từng chi nhánh, tỷ lệ lấp đầy sân và quản lý các chương trình giảm giá',
  },
  '/owner/reconciliation': {
    title: 'Đối soát giao dịch & Hoàn tiền chờ xử lý',
    desc: 'Xử lý các giao dịch chuyển khoản sai tiền, sai nội dung, trễ hạn và các khoản hoàn tiền sau khi khách hủy đơn',
  },
  '/owner/settings': {
    title: 'Cấu hình hệ thống & Quản lý cơ sở',
    desc: 'Thêm, sửa, ngừng hoạt động cơ sở, cập nhật tài khoản nhận chuyển khoản và các tham số như thời gian giữ chỗ, nhận sân, hoàn tiền',
  },
};

export interface StaffOutlet {
  branchFilter: number | 'all';
  setBranchFilter: (v: number | 'all') => void;
  activeBranchId: number | null;
  branches: BranchListItem[];
}

export function StaffLayout() {
  const loc = useLocation();
  const meta = META[loc.pathname] ?? META['/staff/booking'];
  const { user, logout } = useAuth();
  const branchesQ = useBranches({
    status: user?.role === 'OWNER' ? 'ALL' : 'ACTIVE',
  });
  const branches = useMemo(() => branchesQ.data ?? [], [branchesQ.data]);
  const [filter, setBranchFilter] = useState<number | 'all'>('all');

  const isOwner = user?.role === 'OWNER';
  const allowAll =
    loc.pathname === '/staff/stats' ||
    loc.pathname === '/staff/reconciliation' ||
    loc.pathname.startsWith('/owner/');

  const defaultBranchId = user?.branchId ?? branches[0]?.branchId ?? null;
  const branchFilter: number | 'all' = !isOwner
    ? (defaultBranchId ?? 'all')
    : filter === 'all' && !allowAll
      ? (defaultBranchId ?? 'all')
      : filter;

  const activeBranchId: number | null =
    branchFilter === 'all' ? (defaultBranchId ?? null) : branchFilter;

  const currentBranchName =
    branches.find((b) => b.branchId === (user?.branchId ?? activeBranchId))?.name ??
    user?.branchName ??
    'Đang tải...';

  useEffect(() => {
    const ids =
      branchFilter === 'all'
        ? branches.map((b) => b.branchId)
        : [branchFilter];
    for (const id of ids) {
      subscribeRoom({ channel: 'branch', branchId: id });
    }
    return () => {
      for (const id of ids) {
        unsubscribeRoom({ channel: 'branch', branchId: id });
      }
    };
  }, [branchFilter, branches]);

  if (!user) return null;

  const today = todayVn();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="staff-shell">
      <aside className="sidebar">
        <div className="side-logo">
          <div className="mk">
            <img src="/logo-88-sports-transparent-256x256.png" alt="Logo Thể thao 88" />
          </div>
          <div className="col g4" style={{ paddingBottom: 1.5 }}>
            <span className="t16 w800 c-ink" style={{ lineHeight: '16px', letterSpacing: -0.4 }}>
              Thể thao 88 POS
            </span>
            <span className="t11 w500" style={{ color: 'var(--s500)' }}>
              Quản lý & Vận hành sân
            </span>
          </div>
        </div>
        <nav className="side-menu">
          <div className="side-sec">
            <div className="side-title">Nghiệp vụ tại quầy</div>
            <SideItem
              to="/staff/booking"
              label="Đặt sân tại quầy"
              icon={iBooking}
              iconActive={iBookingA}
            />
            <SideItem
              to="/staff/orders"
              label="Quản lý đơn & Nhận sân"
              icon={iOrders}
              iconActive={iOrdersA}
            />
            <SideItem
              to="/staff/stats"
              label="Thống kê trong ngày"
              icon={iStats}
              iconActive={iStatsA}
            />
            {!isOwner && (
              <SideItem
                to="/staff/reconciliation"
                label="Đối soát chuyển khoản"
                icon={iOrders}
                iconActive={iOrdersA}
              />
            )}
          </div>
          {isOwner && (
            <div className="side-sec">
              <div className="side-title gold">Quản trị hệ thống</div>
              <SideItem
                to="/owner/staff"
                label="Quản lý nhân viên"
                icon={iStaff}
                iconActive={iStaffA}
              />
              <SideItem
                to="/owner/courts"
                label="Quản lý sân bãi"
                icon={iCourts}
                iconActive={iCourtsA}
              />
              <SideItem
                to="/owner/reports"
                label="Khuyến mãi & Báo cáo"
                icon={iPromo}
                iconActive={iPromoA}
              />
              <SideItem
                to="/owner/reconciliation"
                label="Đối soát & Hoàn tiền"
                icon={iOrders}
                iconActive={iOrdersA}
              />
              <SideItem
                to="/owner/settings"
                label="Cấu hình hệ thống"
                icon={iSettings}
                iconActive={iSettingsA}
              />
            </div>
          )}
          <div className="side-sec">
            <div className="side-title">Kênh khách hàng</div>
            <Link to="/" className="side-item">
              <img src={iExit} alt="" />
              <span>Ra giao diện khách</span>
            </Link>
          </div>
        </nav>
        <div className="side-user">
          <div className="row g10" style={{ minWidth: 0 }}>
            <div className="avatar lg" style={{ background: 'var(--brand-700)' }}>
              {initials(user.fullName)}
            </div>
            <div className="col" style={{ minWidth: 0 }}>
              <span className="t12 w700 c-ink nowrap">{user.fullName}</span>
              <span className="t11 w600 nowrap" style={{ color: 'var(--brand-700)' }}>
                {user.title}
              </span>
            </div>
          </div>
          <button type="button" className="side-exit" onClick={() => void handleLogout()}>
            Thoát
          </button>
        </div>
      </aside>
      <div className="work">
        <div className="topbar">
          <div className="col">
            <h1 className="t18 w800 c-ink">{meta.title}</h1>
            <p className="t12 c-s600">{meta.desc}</p>
          </div>
          <div className="row g12">
            {/* Trang cấu hình quản lý mọi cơ sở — không cần bộ chọn chi nhánh */}
            {isOwner && loc.pathname === '/owner/settings' ? null : isOwner ? (
              <div className="row g8">
                <span className="t12 w600 c-s600">Chi nhánh:</span>
                <select
                  data-testid="branch-switcher"
                  className="select sm bold fit"
                  style={{ background: 'var(--s100)', padding: '8px 30px 8px 18px' }}
                  value={branchFilter === 'all' ? 'all' : String(branchFilter)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBranchFilter(val === 'all' ? 'all' : Number(val));
                  }}
                >
                  {allowAll && (
                    <option value="all">Tất cả chi nhánh ({branches.length} cơ sở)</option>
                  )}
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.name.replace(' - ', ' – ')}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="chip-box row g8">
                <i
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 9999,
                    background: 'var(--brand-600)',
                  }}
                />
                <span style={{ fontWeight: 700 }}>
                  Chi nhánh: <b className="w900">{currentBranchName}</b>
                </span>
              </div>
            )}
            <div className="chip-box">
              {dow(today)}, {toVN(today)}
            </div>
          </div>
        </div>
        <div className="work-body">
          <Outlet
            context={
              {
                branchFilter,
                setBranchFilter,
                activeBranchId,
                branches,
              } satisfies StaffOutlet
            }
          />
        </div>
      </div>
    </div>
  );
}
