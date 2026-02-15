import {
  Controller,
  Get,
  Body,
  Post,
  Res,
  Req,
  Logger,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Public } from 'src/common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('login-url')
  async getLoginUrl() {
    const loginUrl = await this.authService.getLoginUrl();
    return { loginUrl };
  }

  @Public()
  @Get('callback')
  async ssoCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { accessToken, refreshToken, isNewUser } =
        await this.authService.handleSsoCallback(state, code);

      res.cookie('accessToken', accessToken, {
        maxAge: 60 * 30 * 1000, // 30 minutes
        httpOnly: true,
        // secure: this.configService.get('NODE_ENV') === 'production',
        // sameSite: 'lax',
      });

      res.cookie('refreshToken', refreshToken, {
        maxAge: 60 * 60 * 1000 * 24 * 14, // 14 days
        httpOnly: true,
        // secure: this.configService.get('NODE_ENV') === 'production',
        // sameSite: 'lax',
      });

      if (isNewUser) {
        // A temporary token is issued, and the final login will be completed after the user agrees to the terms.
        // The frontend should redirect to the terms page.
        return res.redirect(
          `${this.configService.get<string>(
            'NEXT_PUBLIC_APP_URL',
          )}/terms-of-service`,
        );
      }

      return res.redirect(
        this.configService.get<string>('NEXT_PUBLIC_APP_URL'),
      );
    } catch (error) {
      Logger.error('SSO Callback failed:', error);
      return res.redirect(
        `${this.configService.get<string>(
          'NEXT_PUBLIC_APP_URL',
        )}/login?error=auth_failed`,
      );
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const newAccessToken = await this.authService.refreshAccessToken(
      req.cookies.refreshToken,
    );
    res.cookie('accessToken', newAccessToken, {
      maxAge: 60 * 30 * 1000, // 30 minutes
      httpOnly: true,
    });
    return { message: 'Access token refreshed' };
  }

  @Get('verify')
  async verify(@Req() req: Request) {
    // The new verify logic will be based on the JWT strategy validating the accessToken.
    // The AuthGuard('jwt') will handle it automatically.
    // If the guard passes, it means the user is authenticated.
    return {
      isLogined: true,
      userInfo: req.user,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<any> {
    await this.authService.logout(req.cookies.refreshToken);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logout successful' };
  }
}
