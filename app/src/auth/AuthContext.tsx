import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type { UserDto } from '@sporthub/shared';
import {
  loginApi,
  logoutApi,
  refreshApi,
  registerApi,
  type AuthTokenResponse,
  type LoginInput,
  type RegisterInput,
} from '../api/auth.ts';
import {
  ApiError,
  clearAccessToken,
  getAccessToken,
  onAuthRevoked,
} from '../api/client.ts';
import { queryClient } from '../api/queryClient.ts';
import { connectSocket, disconnectSocket } from '../api/socket.ts';
import {
  AuthContext,
  type AuthContextValue,
  type AuthRevokedEventPayload,
  type AuthRevokedReason,
} from './authContext.ts';

export interface AuthProviderProps {
  children: ReactNode;
  onSessionRevoked?: (reason?: AuthRevokedReason) => void;
}

// Share an in-flight bootstrap refresh across React StrictMode double-mounts
// so refresh token rotation does not race against itself on initial page load.
let inFlightBootstrapRefresh: Promise<AuthTokenResponse> | null = null;

function runBootstrapRefresh(): Promise<AuthTokenResponse> {
  if (!inFlightBootstrapRefresh) {
    inFlightBootstrapRefresh = refreshApi().finally(() => {
      inFlightBootstrapRefresh = null;
    });
  }
  return inFlightBootstrapRefresh;
}

function isUnauthenticatedError(err: unknown): boolean {
  if (!(err instanceof ApiError)) {
    return false;
  }
  return (
    err.status === 401 ||
    err.code === 'REFRESH_INVALID' ||
    err.code === 'UNAUTHENTICATED' ||
    err.code === 'TOKEN_REVOKED'
  );
}

function RouterNavigateRegistrar({
  onNavigateRef,
}: {
  onNavigateRef: RefObject<((to: string) => void) | null>;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    onNavigateRef.current = (to: string) => {
      navigate(to, { replace: true });
    };
    return () => {
      onNavigateRef.current = null;
    };
  }, [navigate, onNavigateRef]);

  return null;
}

export function AuthProvider({ children, onSessionRevoked }: AuthProviderProps) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(true);

  const inRouter = useInRouterContext();
  const navigateRef = useRef<((to: string) => void) | null>(null);
  const onSessionRevokedRef = useRef(onSessionRevoked);
  const userRef = useRef<UserDto | null>(null);

  useEffect(() => {
    onSessionRevokedRef.current = onSessionRevoked;
  }, [onSessionRevoked]);

  const setAuthenticatedUser = useCallback((nextUser: UserDto | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  }, []);

  const handleSessionRevoked = useCallback(
    (reason?: AuthRevokedReason) => {
      if (!userRef.current) {
        clearAccessToken();
        disconnectSocket();
        return;
      }
      clearAccessToken();
      disconnectSocket();
      setAuthenticatedUser(null);
      queryClient.clear();
      onSessionRevokedRef.current?.(reason);
      navigateRef.current?.('/login');
    },
    [setAuthenticatedUser],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await runBootstrapRefresh();
        if (!cancelled) {
          setAuthenticatedUser(data.user);
        }
      } catch (err) {
        if (!cancelled) {
          clearAccessToken();
          setAuthenticatedUser(null);
          if (!isUnauthenticatedError(err)) {
            disconnectSocket();
          }
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setAuthenticatedUser]);

  useEffect(() => {
    if (!user) {
      disconnectSocket();
      return;
    }

    const socket = connectSocket(getAccessToken());
    const handleSocketRevoked = (payload?: AuthRevokedEventPayload) => {
      handleSessionRevoked(payload?.reason);
    };

    socket.on('auth.revoked', handleSocketRevoked);
    const unsubscribeClientRevoked = onAuthRevoked(() => {
      handleSessionRevoked();
    });

    return () => {
      socket.off('auth.revoked', handleSocketRevoked);
      unsubscribeClientRevoked();
    };
  }, [user, handleSessionRevoked]);

  const login = useCallback(
    async (input: LoginInput): Promise<UserDto> => {
      const data = await loginApi(input);
      setAuthenticatedUser(data.user);
      connectSocket(data.accessToken);
      return data.user;
    },
    [setAuthenticatedUser],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<UserDto> => {
      const data = await registerApi(input);
      setAuthenticatedUser(data.user);
      connectSocket(data.accessToken);
      return data.user;
    },
    [setAuthenticatedUser],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutApi();
    } finally {
      clearAccessToken();
      disconnectSocket();
      setAuthenticatedUser(null);
      queryClient.clear();
    }
  }, [setAuthenticatedUser]);

  const refreshSession = useCallback(async (): Promise<UserDto | null> => {
    try {
      const data = await refreshApi();
      setAuthenticatedUser(data.user);
      connectSocket(data.accessToken);
      return data.user;
    } catch (err) {
      if (isUnauthenticatedError(err)) {
        clearAccessToken();
        disconnectSocket();
        setAuthenticatedUser(null);
        return null;
      }
      throw err;
    }
  }, [setAuthenticatedUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isBootstrapping,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      refreshSession,
    }),
    [user, isBootstrapping, login, register, logout, refreshSession],
  );

  return (
    <AuthContext.Provider value={value}>
      {inRouter ? <RouterNavigateRegistrar onNavigateRef={navigateRef} /> : null}
      {children}
    </AuthContext.Provider>
  );
}
