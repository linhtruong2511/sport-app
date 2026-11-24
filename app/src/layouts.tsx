import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
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
import iExternal from './assets/icons/nav-external.svg';
import iOrdersA from './assets/icons/nav-orders-active.svg';
import iOrders from './assets/icons/nav-orders.svg';
import iPromoA from './assets/icons/nav-promo-active.svg';
import iPromo from './assets/icons/nav-promo.svg';
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
  const { user, isBootstrapping } = useAuth();
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
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  }

  if (ROLE_RANK[user.role] < ROLE_RANK[min]) {
    return <Navigate to={homeOf(user.role)} replace />;
  }

  return <Outlet context={ctx} />;
}

/** Giao diện khách hàng — Trang chủ & Đặt sân mở công khai cho khách chưa đăng nhập. */
export function CustomerLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const unreadQ = useUnreadNotificationsCount({ enabled: user !== null });
  const unreadCount = unreadQ.data?.unreadCount ?? 0;

  const cls = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`;

  const handleLogout = async () => {
    await logout();
    nav('/login');
  };

  return (
    <div className="col" style={{ minHeight: '100vh' }}>
      <header className="hdr">
        <div className="container hdr-in">
          <div className="row g32">
            <Link to="/" className="row g10">
              <div className="logo-mark">S</div>
              <div className="col g4" style={{ paddingBottom: 2 }}>
                <span className="logo-name">SportHub</span>
                <span className="logo-sub">Đặt sân thể thao trực tuyến</span>
              </div>
            </Link>
            <nav className="row g6">
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
          {user ? (
            <div className="row g12">
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
            <div className="row g8">
              <Link to="/login" className="btn btn-outline btn-md">
                Đăng nhập
              </Link>
              <Link to="/login" state={{ tab: 'register' }} className="btn btn-primary btn-md">
                Đăng ký
              </Link>
            </div>
          )}
        </div>
      </header>
      <main className="container col g24" style={{ flex: 1, padding: '32px 24px 64px' }}>
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
  const nav = useNavigate();
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
    nav('/login');
  };

  return (
    <div className="staff-shell">
      <aside className="sidebar">
        <div className="side-logo">
          <div className="mk">S</div>
          <div className="col g4" style={{ paddingBottom: 1.5 }}>
            <span className="t16 w800 c-white" style={{ lineHeight: '16px', letterSpacing: -0.4 }}>
              SportHub POS
            </span>
            <span className="t11 w500" style={{ color: 'var(--s400)' }}>
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
            </div>
          )}
          <div className="side-sec">
            <div className="side-title">Kênh khách hàng</div>
            <Link to="/" className="side-item">
              <img src={iExternal} alt="" />
              <span>{isOwner ? 'Giao diện Khách đặt sân' : 'Quay lại'}</span>
            </Link>
          </div>
        </nav>
        <div className="side-user">
          <div className="row g10" style={{ minWidth: 0 }}>
            <div className="avatar lg" style={{ background: 'var(--brand-700)' }}>
              {initials(user.fullName)}
            </div>
            <div className="col" style={{ minWidth: 0 }}>
              <span className="t12 w700 c-white nowrap">{user.fullName}</span>
              <span className="t11 w500 nowrap" style={{ color: 'var(--brand-400)' }}>
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
            {isOwner ? (
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
