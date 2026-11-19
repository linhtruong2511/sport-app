import { useState } from 'react'
import { TODAY, branchOf } from '../data'
import type { Booking } from '../data'
import { useApp } from '../appContext'
import { holidayOn, slotsFor } from '../domain/slots'
import { mins, toVN, vnd } from '../utils/format'

interface Props { list: Booking[]; testId?: string; emptyText?: string }

/** UC 021 — Danh sách đơn bị ảnh hưởng + xử lý: Chuyển sân / Đổi giờ (giữ nguyên mã & tiền) hoặc Đóng đơn do cơ sở. */
export default function AffectedBookingsModal({ list, testId = 'affected-warning-list', emptyText }: Props) {
  const { courts, branches, holidays, blocker, lockAt, reassignBooking, closeByFacility, toast } = useApp()
  const [target, setTarget] = useState<{ b: Booking; mode: 'reassign' | 'close' } | null>(null)
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('same')
  const [courtId, setCourtId] = useState('')
  const [note, setNote] = useState('')

  const open = (b: Booking, mode: 'reassign' | 'close') => { setTarget({ b, mode }); setDate(b.date); setSlot('same'); setCourtId(''); setNote('') }
  const cName = (id: string) => courts.find((c) => c.id === id)?.name ?? id

  const b = target?.b
  const src = b ? courts.find((c) => c.id === b.courtId) : undefined
  const branch = src ? branchOf(src.branchId) : undefined
  const slots = branch ? slotsFor(branches.find((x) => x.id === branch.id) ?? branch, holidays, date) : []
  const newStart = !b ? '' : slot === 'same' ? b.start : slot.split('-')[0]
  const newEnd = !b ? '' : slot === 'same' ? b.end : slot.split('-')[1]
  const duration = b ? mins(b.end) - mins(b.start) : 0
  const endAdj = newEnd
  const options = !b || !src ? [] : courts.filter((c) => c.branchId === src.branchId && c.sport === src.sport && c.active && c.id !== src.id
    && !holidayOn(holidays, date, c.branchId) && !blocker(c.id, date, newStart, endAdj, b.id) && !lockAt(c.id, date, newStart, endAdj))
  const chosen = courtId && options.some((c) => c.id === courtId) ? courtId : options[0]?.id ?? ''
  const slotOk = slot === 'same' || mins(newEnd) - mins(newStart) >= 0

  const confirmReassign = () => {
    if (!b || !chosen) return toast('Không có sân phù hợp để chuyển.', 'err')
    if (!date || date < TODAY) return toast('Ngày chuyển không hợp lệ.', 'err')
    reassignBooking(b.id, { courtId: chosen, date, start: newStart, end: endAdj })
    toast(`Đã chuyển sân #${b.id} sang ${cName(chosen)}. Khách được thông báo, mã đơn & số tiền giữ nguyên.`, 'ok')
    setTarget(null)
  }
  const confirmClose = () => {
    if (!b) return
    closeByFacility(b.id, note.trim())
    toast(`Đã đóng đơn #${b.id} do cơ sở. Khoản hoàn trả ${vnd(b.paid)} được ghi nhận chờ hoàn tiền.`, 'ok')
    setTarget(null)
  }

  return (
    <>
      <div className="col g8" data-testid={testId}>
        {list.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>{emptyText ?? 'Không có đơn nào bị ảnh hưởng.'}</div>}
        {list.map((x) => (
          <div key={x.id} className="row between g12 wrap" style={{ background: 'var(--amber-50)', border: '2px solid var(--amber-400)', borderRadius: 12, padding: 12 }}>
            <div className="col g2">
              <b className="t12 c-ink"><span className="mono">#{x.id}</span> • {x.customer} ({x.phone})</b>
              <span className="t12 c-s700">{cName(x.courtId)} • {toVN(x.date)} • {x.start} - {x.end} • Đã trả {vnd(x.paid)}</span>
              <span className="t11 c-amber">{x.affectedReason ?? 'Đơn bị ảnh hưởng do cơ sở thay đổi lịch'}</span>
            </div>
            <div className="row g8">
              <button className="btn btn-primary btn-sm" data-testid={`reassign-btn-${x.id}`} onClick={() => open(x, 'reassign')}>Chuyển sân / Đổi giờ</button>
              <button className="btn btn-danger-o btn-sm" data-testid={`close-btn-${x.id}`} onClick={() => open(x, 'close')}>Đóng đơn do cơ sở</button>
            </div>
          </div>
        ))}
      </div>

      {target && b && (
        <div className="modal-bg" onClick={() => setTarget(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            {target.mode === 'reassign' ? (
              <>
                <h3 className="t18 w800 c-ink">Chuyển sân / Đổi giờ đơn #{b.id}</h3>
                <p className="t12 c-s600">Giữ nguyên mã đơn và số tiền đã thanh toán ({vnd(b.paid)}). Khách sẽ nhận thông báo về lịch mới.</p>
                <div><label className="label">Ngày chơi mới</label><input className="input sm" type="date" min={TODAY} value={date} onChange={(e) => { setDate(e.target.value); setCourtId('') }} /></div>
                <div><label className="label">Khung giờ</label>
                  <select className="select sm" value={slot} onChange={(e) => setSlot(e.target.value)}>
                    <option value="same">Giữ nguyên giờ ({b.start} - {b.end})</option>
                    {slots.filter((s) => mins(s.end) - mins(s.start) >= duration).map((s) => <option key={s.start} value={`${s.start}-${s.end}`}>{s.start} - {s.end}</option>)}
                  </select></div>
                <div><label className="label">Sân thay thế (cùng chi nhánh & bộ môn)</label>
                  <select data-testid="reassign-target-court" className="select sm" value={chosen} onChange={(e) => setCourtId(e.target.value)}>
                    {options.length === 0 && <option value="">Không còn sân trống phù hợp</option>}
                    {options.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                  {options.length > 0 && <p className="t11 c-s600" style={{ marginTop: 4 }}>{options.map((c) => c.name).join(' • ')}</p>}
                </div>
                <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline btn-md" onClick={() => setTarget(null)}>Đóng</button>
                  <button className="btn btn-primary btn-md" disabled={!chosen || !slotOk} onClick={confirmReassign}>Xác nhận chuyển</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="t18 w800 c-ink">Đóng đơn #{b.id} do cơ sở?</h3>
                <div className="hint" style={{ background: 'var(--rose-50)', borderColor: 'var(--rose-300)', color: 'var(--rose-950)' }}>
                  Đơn sẽ chuyển sang <b>Đã hủy</b> (phân loại: do cơ sở). Khoản <b>{vnd(b.paid)}</b> đã thu được đánh dấu <b>cần hoàn trả ngoài hệ thống</b> và <b>không tính vào doanh thu thực thu</b>.
                </div>
                <div><label className="label">Ghi chú gửi khách</label><input className="input sm" placeholder="VD: Sân ngừng khai thác để sửa chữa" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline btn-md" onClick={() => setTarget(null)}>Đóng</button>
                  <button className="btn btn-danger btn-md" onClick={confirmClose}>Xác nhận đóng đơn</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
