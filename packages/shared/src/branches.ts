import { z } from 'zod';

/**
 * R-17: Danh sách ngân hàng VietQR phổ biến (mã BIN theo NAPAS) để Chủ sân chọn khi cấu hình
 * tài khoản nhận chuyển khoản của cơ sở. Ngân hàng không có trong danh sách: chọn "Khác" và nhập BIN 6 số.
 */
export interface VietQrBank {
  readonly bin: string;
  readonly shortName: string;
  readonly name: string;
}

export const VIETQR_BANKS: readonly VietQrBank[] = [
  { bin: '970436', shortName: 'Vietcombank', name: 'Ngân hàng TMCP Ngoại thương Việt Nam' },
  { bin: '970415', shortName: 'VietinBank', name: 'Ngân hàng TMCP Công thương Việt Nam' },
  { bin: '970418', shortName: 'BIDV', name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam' },
  { bin: '970405', shortName: 'Agribank', name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn' },
  { bin: '970422', shortName: 'MB Bank', name: 'Ngân hàng TMCP Quân đội' },
  { bin: '970407', shortName: 'Techcombank', name: 'Ngân hàng TMCP Kỹ thương Việt Nam' },
  { bin: '970416', shortName: 'ACB', name: 'Ngân hàng TMCP Á Châu' },
  { bin: '970432', shortName: 'VPBank', name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng' },
  { bin: '970423', shortName: 'TPBank', name: 'Ngân hàng TMCP Tiên Phong' },
  { bin: '970403', shortName: 'Sacombank', name: 'Ngân hàng TMCP Sài Gòn Thương Tín' },
  { bin: '970437', shortName: 'HDBank', name: 'Ngân hàng TMCP Phát triển TP. Hồ Chí Minh' },
  { bin: '970441', shortName: 'VIB', name: 'Ngân hàng TMCP Quốc tế Việt Nam' },
  { bin: '970443', shortName: 'SHB', name: 'Ngân hàng TMCP Sài Gòn – Hà Nội' },
  { bin: '970431', shortName: 'Eximbank', name: 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam' },
  { bin: '970426', shortName: 'MSB', name: 'Ngân hàng TMCP Hàng Hải Việt Nam' },
  { bin: '970448', shortName: 'OCB', name: 'Ngân hàng TMCP Phương Đông' },
  { bin: '970454', shortName: 'Bản Việt', name: 'Ngân hàng TMCP Bản Việt' },
  { bin: '970449', shortName: 'LPBank', name: 'Ngân hàng TMCP Lộc Phát Việt Nam' },
];

const emptyToNull = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? null : val;

export const branchCodeSchema = z
  .string({ required_error: 'Vui lòng nhập mã cơ sở.' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{2,20}$/, 'Mã cơ sở gồm 2–20 ký tự chữ in hoa, số, "-" hoặc "_".');

const branchNameSchema = z
  .string({ required_error: 'Vui lòng nhập tên cơ sở.' })
  .trim()
  .min(2, 'Tên cơ sở phải từ 2 đến 150 ký tự.')
  .max(150, 'Tên cơ sở phải từ 2 đến 150 ký tự.');

const branchAddressSchema = z
  .string({ required_error: 'Vui lòng nhập địa chỉ cơ sở.' })
  .trim()
  .min(5, 'Địa chỉ phải từ 5 đến 255 ký tự.')
  .max(255, 'Địa chỉ phải từ 5 đến 255 ký tự.');

// Số máy bàn (02x…, 10–11 số) hoặc di động (10 số).
const branchPhoneSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^0\d{9,10}$/, 'Số điện thoại cơ sở gồm 10–11 chữ số và bắt đầu bằng 0.')
    .nullable()
    .optional(),
);

const branchDescriptionSchema = z.preprocess(
  emptyToNull,
  z.string().trim().max(1000, 'Mô tả tối đa 1000 ký tự.').nullable().optional(),
);

const bankBinSchema = z.preprocess(
  emptyToNull,
  z.string().trim().regex(/^\d{6}$/, 'Mã BIN ngân hàng gồm đúng 6 chữ số.').nullable().optional(),
);
const bankNameSchema = z.preprocess(
  emptyToNull,
  z.string().trim().max(100, 'Tên ngân hàng tối đa 100 ký tự.').nullable().optional(),
);
const bankAccountNoSchema = z.preprocess(
  (val) => (typeof val === 'string' ? emptyToNull(val.replace(/\s+/g, '')) : val),
  z.string().regex(/^\d{6,30}$/, 'Số tài khoản gồm 6–30 chữ số.').nullable().optional(),
);
// Tên chủ tài khoản theo VietQR: chữ in hoa không dấu.
const bankAccountNameSchema = z.preprocess(
  (val) => (typeof val === 'string' ? emptyToNull(val.trim().toUpperCase()) : val),
  z
    .string()
    .max(100, 'Tên chủ tài khoản tối đa 100 ký tự.')
    .regex(/^[A-Z0-9 .&-]+$/, 'Tên chủ tài khoản viết in hoa, không dấu (VD: CONG TY SPORTHUB CS1).')
    .nullable()
    .optional(),
);

const BANK_FIELDS = ['bankBin', 'bankName', 'bankAccountNo', 'bankAccountName'] as const;

const branchBaseShape = {
  name: branchNameSchema,
  address: branchAddressSchema,
  phone: branchPhoneSchema,
  description: branchDescriptionSchema,
  bankBin: bankBinSchema,
  bankName: bankNameSchema,
  bankAccountNo: bankAccountNoSchema,
  bankAccountName: bankAccountNameSchema,
};

type BankFieldsInput = Partial<Record<(typeof BANK_FIELDS)[number], string | null | undefined>>;

// R-17: thông tin nhận chuyển khoản phải đủ cả 4 trường hoặc bỏ trống cả 4.
function refineBankGroup(val: BankFieldsInput, ctx: z.RefinementCtx) {
  const filled = BANK_FIELDS.filter((f) => val[f] != null && val[f] !== '');
  if (filled.length > 0 && filled.length < BANK_FIELDS.length) {
    for (const f of BANK_FIELDS) {
      if (val[f] == null || val[f] === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [f],
          message: 'Vui lòng nhập đủ ngân hàng, số tài khoản và tên chủ tài khoản (hoặc bỏ trống cả nhóm).',
        });
      }
    }
  }
}

// EXT-02
export const createBranchSchema = z
  .object({ code: branchCodeSchema, ...branchBaseShape })
  .superRefine(refineBankGroup);

// EXT-03 — Mã cơ sở bất biến sau khi tạo; trạng thái đổi qua deactivate/activate.
export const updateBranchSchema = z.object(branchBaseShape).superRefine(refineBankGroup);

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

