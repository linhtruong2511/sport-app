import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CustomerLayout, Guard, StaffLayout } from './layouts'
import { useApp } from './appContext'
import { homeOf } from './utils/format'
import Login from './pages/Login'
import Home from './pages/Home'
import Booking from './pages/Booking'
import Payment from './pages/Payment'
import MyBookings from './pages/MyBookings'
import StaffBooking from './pages/StaffBooking'
import StaffOrders from './pages/StaffOrders'
import StaffStats from './pages/StaffStats'
import OwnerStaff from './pages/OwnerStaff'
import OwnerCourts from './pages/OwnerCourts'
import OwnerReports from './pages/OwnerReports'
import Reconciliation from './pages/Reconciliation'

function LoginRoute() {
  const { user } = useApp()
  const loc = useLocation()
  if (!user) return <Login />
  const from = (loc.state as { from?: string } | null)?.from
  // Chỉ quay lại trang trước đó nếu vẫn thuộc khu vực của vai trò vừa đăng nhập (tránh nhảy sang trang của phiên cũ)
  const own = user.role === 'customer' ? !!from && !from.startsWith('/staff') && !from.startsWith('/owner') : !!from && from.startsWith(user.role === 'owner' ? '/owner' : '/staff')
  return <Navigate to={own && from !== '/login' ? from! : homeOf(user.role)} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      {/* Khách hàng (nhân viên & chủ sân kế thừa) — Trang chủ & Đặt sân mở công khai cho Guest */}
      <Route element={<CustomerLayout />}>
        <Route index element={<Home />} />
        <Route path="booking" element={<Booking />} />
        <Route element={<Guard min="customer" />}>
          <Route path="payment/:id" element={<Payment />} />
          <Route path="my-bookings" element={<MyBookings />} />
        </Route>
      </Route>
      {/* Nhân viên (chủ sân kế thừa) */}
      <Route element={<Guard min="staff" />}>
        <Route element={<StaffLayout />}>
          <Route path="staff/booking" element={<StaffBooking />} />
          <Route path="staff/orders" element={<StaffOrders />} />
          <Route path="staff/stats" element={<StaffStats />} />
          {/* Chủ sân */}
          <Route element={<Guard min="owner" />}>
            <Route path="owner/staff" element={<OwnerStaff />} />
            <Route path="owner/courts" element={<OwnerCourts />} />
            <Route path="owner/reports" element={<OwnerReports />} />
            <Route path="owner/reconciliation" element={<Reconciliation />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
