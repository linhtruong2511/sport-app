import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/authContext.ts';
import { CustomerLayout, Guard, StaffLayout } from './layouts.tsx';
import Booking from './pages/Booking.tsx';
import Home from './pages/Home.tsx';
import Login from './pages/Login.tsx';
import MyBookings from './pages/MyBookings.tsx';
import OwnerCourts from './pages/OwnerCourts.tsx';
import OwnerReports from './pages/OwnerReports.tsx';
import OwnerStaff from './pages/OwnerStaff.tsx';
import Payment from './pages/Payment.tsx';
import Reconciliation from './pages/Reconciliation.tsx';
import StaffBooking from './pages/StaffBooking.tsx';
import StaffOrders from './pages/StaffOrders.tsx';
import StaffStats from './pages/StaffStats.tsx';
import { homeOf } from './utils/format.ts';

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
  );
}
