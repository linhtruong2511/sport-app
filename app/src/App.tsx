import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/authContext.ts';
import { CustomerLayout, Guard, StaffLayout } from './layouts.tsx';
import { homeOf } from './utils/format.ts';

const Booking = lazy(() => import('./pages/Booking.tsx'));
const Home = lazy(() => import('./pages/Home.tsx'));
const Login = lazy(() => import('./pages/Login.tsx'));
const MyBookings = lazy(() => import('./pages/MyBookings.tsx'));
const OwnerCourts = lazy(() => import('./pages/OwnerCourts.tsx'));
const OwnerReports = lazy(() => import('./pages/OwnerReports.tsx'));
const OwnerStaff = lazy(() => import('./pages/OwnerStaff.tsx'));
const Payment = lazy(() => import('./pages/Payment.tsx'));
const Reconciliation = lazy(() => import('./pages/Reconciliation.tsx'));
const StaffBooking = lazy(() => import('./pages/StaffBooking.tsx'));
const StaffOrders = lazy(() => import('./pages/StaffOrders.tsx'));
const StaffStats = lazy(() => import('./pages/StaffStats.tsx'));

function RouteLoadingFallback() {
  return (
    <div className="center" style={{ minHeight: '60vh' }}>
      <span className="t14 c-s600">Đang tải trang...</span>
    </div>
  );
}

function LoginRoute() {
  const { user, isBootstrapping } = useAuth();
  const loc = useLocation();

  if (isBootstrapping) {
    return (
      <div className="center" style={{ minHeight: '100vh' }}>
        <span className="t14 c-s600">Đang khôi phục phiên đăng nhập...</span>
      </div>
    );
  }

  if (!user) return <Login />;

  const from = (loc.state as { from?: string } | null)?.from;
  const own =
    user.role === 'CUSTOMER'
      ? Boolean(from) && !from!.startsWith('/staff') && !from!.startsWith('/owner')
      : user.role === 'STAFF'
        ? Boolean(from) && from!.startsWith('/staff')
        : Boolean(from) && (from!.startsWith('/owner') || from!.startsWith('/staff'));

  return <Navigate to={own && from !== '/login' ? from! : homeOf(user.role)} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        {/* Khách hàng (nhân viên & chủ sân kế thừa) — Trang chủ & Đặt sân mở công khai */}
        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="booking" element={<Booking />} />
          <Route element={<Guard min="CUSTOMER" />}>
            <Route path="payment/:bookingCode" element={<Payment />} />
            <Route path="my-bookings" element={<MyBookings />} />
          </Route>
        </Route>
        {/* Nhân viên (chủ sân kế thừa) */}
        <Route element={<Guard min="STAFF" />}>
          <Route element={<StaffLayout />}>
            <Route path="staff/booking" element={<StaffBooking />} />
            <Route path="staff/orders" element={<StaffOrders />} />
            <Route path="staff/stats" element={<StaffStats />} />
            <Route path="staff/reconciliation" element={<Reconciliation />} />
            {/* Chủ sân */}
            <Route element={<Guard min="OWNER" />}>
              <Route path="owner/staff" element={<OwnerStaff />} />
              <Route path="owner/courts" element={<OwnerCourts />} />
              <Route path="owner/reports" element={<OwnerReports />} />
              <Route path="owner/reconciliation" element={<Reconciliation />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
