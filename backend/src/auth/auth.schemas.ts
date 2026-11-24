import { emailSchema, fullNameSchema, passwordSchema, phoneSchema } from '@sporthub/shared/validators';
import { z } from 'zod';

// SDD API-06
export const loginSchema = z.object({
  identity: z
    .string({ required_error: 'Vui lòng nhập số điện thoại hoặc email.' })
    .trim()
    .min(1, 'Vui lòng nhập số điện thoại hoặc email.'),
  password: z
    .string({ required_error: 'Mật khẩu phải có tối thiểu 6 ký tự.' })
    .min(6, 'Mật khẩu phải có tối thiểu 6 ký tự.')
    .max(32, 'Mật khẩu phải từ 6 đến 32 ký tự.'),
});

export type LoginDto = z.infer<typeof loginSchema>;

// SDD API-10
export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    email: z
      .string({ required_error: 'Email là bắt buộc khi đăng ký hội viên.' })
      .trim()
      .min(1, 'Email là bắt buộc khi đăng ký hội viên.')
      .pipe(emailSchema),
    password: passwordSchema,
    confirmPassword: z.string({ required_error: 'Vui lòng nhập lại mật khẩu.' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu nhập lại không khớp.',
  });

export type RegisterDto = z.infer<typeof registerSchema>;
