import type { ReactNode } from 'react';
import { AuthProvider } from './auth/AuthContext.tsx';
import type { AuthRevokedReason } from './auth/authContext.ts';
import { RealtimeBridge } from './realtime/RealtimeBridge.tsx';
import { useToast } from './ui/toastContext.ts';

export function AppRoot({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  const handleRevoked = (reason?: AuthRevokedReason) => {
    if (reason === 'ACCOUNT_LOCKED') {
      toast('Tài khoản của bạn đã bị khóa bởi quản trị viên.', 'err');
      return;
    }
    if (reason === 'BRANCH_CHANGED') {
      toast('Chi nhánh làm việc đã thay đổi. Vui lòng đăng nhập lại.', 'err');
      return;
    }
    toast('Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại.', 'err');
  };

  return (
    <AuthProvider onSessionRevoked={handleRevoked}>
      <RealtimeBridge />
      {children}
    </AuthProvider>
  );
}
