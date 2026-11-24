import { describe, expect, it } from 'vitest';
import { buildVietQrPayload, crc16Ccitt } from '../vietqr.js';

describe('payments/vietqr', () => {
  it('computes standard CRC16-CCITT (FALSE) test vector', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1');
  });

  it('builds valid EMVCo NAPAS VietQR payload with CRC16 checksum', () => {
    const payload = buildVietQrPayload({
      bankBin: '970436',
      accountNo: '1012345678',
      amount: 90000,
      transferContent: 'THANHTOAN BK2026111008',
    });

    expect(payload.startsWith('000201010212')).toBe(true);
    expect(payload).toContain('0010A000000727');
    expect(payload).toContain('000697043601101012345678');
    expect(payload).toContain('0208QRIBFTTA');
    expect(payload).toContain('5303704');
    expect(payload).toContain('540590000');
    expect(payload).toContain('5802VN');
    expect(payload).toContain('62260822THANHTOAN BK2026111008');

    const bodyForCrc = payload.slice(0, -4);
    const crc = payload.slice(-4);
    expect(bodyForCrc.endsWith('6304')).toBe(true);
    expect(crc).toBe(crc16Ccitt(bodyForCrc));
  });
});
