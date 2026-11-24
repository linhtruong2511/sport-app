/** Lỗi nghiệp vụ theo định dạng SDD mục 5.2: { error: { code, message, details, traceId } } */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const E = {
  validation: (message: string, details?: unknown) => new ApiError(400, 'VALIDATION_ERROR', message, details),
  field: (field: string, message: string) =>
    new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', [{ field, message }]),
  dateRange: (message = 'Khoảng thời gian tra cứu không hợp lệ (Từ ngày phải trước hoặc bằng Đến ngày).') =>
    new ApiError(400, 'INVALID_DATE_RANGE', message),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập để tiếp tục.'),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này.') => new ApiError(403, 'FORBIDDEN', message),
  branchForbidden: () =>
    new ApiError(403, 'BRANCH_FORBIDDEN', 'Bạn chỉ được thao tác dữ liệu của chi nhánh được phân công.'),
  bookingForbidden: () => new ApiError(403, 'BOOKING_FORBIDDEN', 'Không có quyền truy cập đơn đặt sân này.'),
  notFound: (message = 'Không tìm thấy tài nguyên.', code = 'NOT_FOUND') => new ApiError(404, code, message),
  conflict: (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details),
  rule: (code: string, message: string, details?: unknown) => new ApiError(422, code, message, details),
};
