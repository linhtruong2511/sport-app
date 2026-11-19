import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TODAY } from '../data'
import type { NotifType } from '../data'
import { useApp } from '../appContext'

const TYPES: [NotifType | 'all', string][] = [['all', 'Tất cả loại'], ['REMINDER', 'Nhắc lịch'], ['PROMO', 'Ưu đãi'], ['PAYMENT', 'Thanh toán'], ['REASSIGN', 'Đổi sân'], ['CANCEL', 'Hủy đơn']]

/** Trung tâm Thông báo động (UC 026): lọc theo loại / trạng thái đọc, đánh dấu đã đọc, deep-link kiểm tra mã ưu đãi. */
export default function NotificationInbox() {
  const { user, notifications, promos, markRead, markAllRead, unreadCount, toast } = useApp()
  const nav = useNavigate()
  const [type, setType] = useState<NotifType | 'all'>('all')
  const [read, setRead] = useState<'all' | 'unread' | 'read'>('all')
  const phone = user?.phone ?? ''
  const mine = notifications.filter((n) => n.to === 'ALL' || n.to === phone)
  const isRead = (readBy: string[]) => readBy.includes(phone)
  const list = mine.filter((n) => (type === 'all' || n.type === type) && (read === 'all' || (read === 'read') === isRead(n.readBy)))

  const applyCode = (code: string, id: string) => {
    markRead(id)
    const p = promos.find((x) => x.code === code)
    if (!p || p.status === 'discontinued' || p.end < TODAY) return toast('Chương trình ưu đãi đã kết thúc.', 'err')
    nav(`/booking?promo=${code}`)
  }

  return (
    <aside className="span4 card col g16" style={{ boxShadow: 'var(--shadow-sm)', alignSelf: 'flex-start' }}>
      <div className="row between head-rule">
        <div className="row g8"><i style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--brand-700)' }} /><h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Thông báo nhắc lịch & Ưu đãi</h2></div>
        <span className="badge c-white" style={{ background: unreadCount ? 'var(--brand-700)' : 'var(--s500)', padding: '2px 10px' }}>{unreadCount} mới</span>
      </div>
      <div className="row g8">
        <select data-testid="notif-filter-type" className="select sm" value={type} onChange={(e) => setType(e.target.value as NotifType | 'all')}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select data-testid="notif-filter-read" className="select sm" value={read} onChange={(e) => setRead(e.target.value as 'all' | 'unread' | 'read')}>
          <option value="all">Tất cả</option><option value="unread">Chưa đọc</option><option value="read">Đã đọc</option>
        </select>
      </div>
      {unreadCount > 0 && <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={markAllRead}>Đánh dấu tất cả đã đọc</button>}
      {list.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>Không có thông báo nào phù hợp.</div>}
      {list.map((n) => {
        const unread = !isRead(n.readBy)
        return (
          <div key={n.id} data-testid={`notif-${n.id}`} className="col g6" style={{ background: unread ? 'var(--brand-50)' : 'var(--s100)', border: unread ? '2px solid var(--brand-600)' : '1px solid var(--s300)', borderRadius: 12, padding: 16 }}>
            <div className="row between g8"><b className="t12 c-ink">{n.title}</b><b className="t10 c-s500" style={{ fontWeight: 600 }}>{n.at}</b></div>
            <p className="t12 c-s700" style={{ lineHeight: '19.5px' }}>{n.body}</p>
            <div className="row g12">
              {n.promoCode && <button className="link-btn" onClick={() => applyCode(n.promoCode!, n.id)}>Dùng mã {n.promoCode} →</button>}
              {unread && <button className="link-btn" style={{ color: 'var(--s600)' }} onClick={() => markRead(n.id)}>Đánh dấu đã đọc</button>}
            </div>
          </div>
        )
      })}
    </aside>
  )
}
