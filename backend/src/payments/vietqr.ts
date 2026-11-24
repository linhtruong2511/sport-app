export interface VietQrInput {
  bankBin: string;
  accountNo: string;
  amount: number;
  transferContent: string;
}

function tlv(tag: string, value: string): string {
  const len = String(Buffer.byteLength(value, 'utf8')).padStart(2, '0');
  return `${tag}${len}${value}`;
}

/**
 * Standard CRC16-CCITT (FALSE): polynomial 0x1021, initial value 0xFFFF, no final XOR.
 */
export function crc16Ccitt(input: string): string {
  const bytes = Buffer.from(input, 'utf8');
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * SDD 2.6 & 5.5 API-16: Generates NAPAS EMVCo VietQR payload string.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  const bankBin = input.bankBin.trim();
  const accountNo = input.accountNo.trim();
  const amountInt = Math.round(input.amount);
  const transferContent = input.transferContent.trim();

  const bankNetworkInfo = tlv('00', bankBin) + tlv('01', accountNo);
  const merchantAccountInfo = tlv('00', 'A000000727') + tlv('01', bankNetworkInfo) + tlv('02', 'QRIBFTTA');
  const additionalData = tlv('08', transferContent);

  const bodyWithoutCrc =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchantAccountInfo) +
    tlv('53', '704') +
    (amountInt > 0 ? tlv('54', String(amountInt)) : '') +
    tlv('58', 'VN') +
    tlv('62', additionalData) +
    '6304';

  return `${bodyWithoutCrc}${crc16Ccitt(bodyWithoutCrc)}`;
}
