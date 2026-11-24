import type { ApiSuccess, UserDto } from '@sporthub/shared';
import { apiFetch, clearAccessToken, setAccessToken } from './client.ts';

export interface LoginInput {
  identity: string;
  password: string;
}

export interface RegisterInput {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn: number;
  user: UserDto;
}

export async function loginApi(input: LoginInput): Promise<AuthTokenResponse> {
  const res = await apiFetch<ApiSuccess<AuthTokenResponse>>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuthRefresh: true,
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function registerApi(input: RegisterInput): Promise<AuthTokenResponse> {
  const res = await apiFetch<ApiSuccess<AuthTokenResponse>>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuthRefresh: true,
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function refreshApi(): Promise<AuthTokenResponse> {
  const res = await apiFetch<ApiSuccess<AuthTokenResponse>>('/auth/refresh', {
    method: 'POST',
    skipAuthRefresh: true,
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function getMeApi(): Promise<UserDto> {
  const res = await apiFetch<ApiSuccess<UserDto>>('/auth/me');
  return res.data;
}

export async function logoutApi(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', {
      method: 'POST',
    });
  } finally {
    clearAccessToken();
  }
}
