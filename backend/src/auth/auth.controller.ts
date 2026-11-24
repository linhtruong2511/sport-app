import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { CurrentUser } from '../core/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import { type LoginDto, type RegisterDto, loginSchema, registerSchema } from './auth.schemas.js';
import { AuthService, type RequestMeta } from './auth.service.js';

const REFRESH_COOKIE_NAME = 'sh_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function extractRequestMeta(req: Request): RequestMeta {
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const ipAddress = req.ip || req.socket?.remoteAddress || null;
  return { userAgent, ipAddress };
}

function setRefreshCookie(res: Response, rawRefreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: env.refreshTokenDays * 86_400_000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.authService.me(user.userId);
    return ok(profile, this.clock);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken =
      typeof req.cookies?.[REFRESH_COOKIE_NAME] === 'string'
        ? req.cookies[REFRESH_COOKIE_NAME]
        : undefined;
    const result = await this.authService.refresh(rawRefreshToken, extractRequestMeta(req));
    setRefreshCookie(res, result.rawRefreshToken);
    return ok(
      {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      this.clock,
    );
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, extractRequestMeta(req));
    setRefreshCookie(res, result.rawRefreshToken);
    return ok(
      {
        accessToken: result.accessToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      this.clock,
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawRefreshToken =
      typeof req.cookies?.[REFRESH_COOKIE_NAME] === 'string'
        ? req.cookies[REFRESH_COOKIE_NAME]
        : undefined;
    await this.authService.logout(rawRefreshToken);
    clearRefreshCookie(res);
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto, extractRequestMeta(req));
    setRefreshCookie(res, result.rawRefreshToken);
    return ok(
      {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      this.clock,
    );
  }
}
