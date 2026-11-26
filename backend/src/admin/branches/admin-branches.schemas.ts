import { createBranchSchema, updateBranchSchema } from '@sporthub/shared/branches';
import { z } from 'zod';

export { createBranchSchema, updateBranchSchema };

export const branchIdParamSchema = z.object({
  branchId: z.coerce.number().int().positive('Mã cơ sở không hợp lệ.'),
});

export type BranchIdParam = z.infer<typeof branchIdParamSchema>;
export type CreateBranchDto = z.infer<typeof createBranchSchema>;
export type UpdateBranchDto = z.infer<typeof updateBranchSchema>;
