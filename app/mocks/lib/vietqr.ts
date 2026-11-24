/**
 * Sinh chuỗi VietQR (EMVCo) thật để frontend vẽ bằng qrcode.react — SDD mục 2.6a.
 * Ứng dụng ngân hàng quét được (đúng STK, số tiền, nội dung) nhưng đây là dữ liệu demo.
 */
const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildVietQr(bin: string, accountNo: string, amount: number, content: string): string {
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', accountNo)) + tlv('02', 'QRIBFTTA');
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchant) +
    tlv('53', '704') +
    tlv('54', String(Math.round(amount))) +
    tlv('58', 'VN') +
    tlv('62', tlv('08', content)) +
    '6304';
  return body + crc16(body);
}
