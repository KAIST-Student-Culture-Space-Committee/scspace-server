import {
  Controller,
  Get,
  Body,
  Post,
  Res,
  Req,
  Logger,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { UserPublicService } from '../user/user.public.service';
import { IUser } from '@scspace-depot/types/user';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userPublicService: UserPublicService,
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
    // first generate Tokens.
    @Query('state') state: string,
    @Query('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.authService.handleSsoCallback(state, code);

      if (result.status === 'consent_required') {
        return res.redirect(
          `${this.configService.get<string>(
            'NEXT_PUBLIC_APP_URL',
          )}/login?privacyConsentRequired=true&token=${result.consentToken}`,
        );
      }

      const { accessToken, refreshToken, isNewUser } = result;

      res.cookie('accessToken', accessToken, {
        maxAge: 30 * 60 * 1000, // 30 minutes
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'lax',
      });

      res.cookie('refreshToken', refreshToken, {
        maxAge: 60 * 60 * 1000 * 24 * 14, // 14 days
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'lax',
      });

      if (isNewUser) {
        // A temporary token is issued, and the final login will be completed after the user agrees to the terms.
        // The frontend should redirect to the terms page.
        return res.redirect(
          `${this.configService.get<string>('NEXT_PUBLIC_APP_URL')}`,
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

  @Public()
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
      secure: this.configService.get('NODE_ENV') === 'production',
      sameSite: 'lax',
    });
    return { message: 'Access token refreshed' };
  }

  @Public()
  @Post('accept-privacy-consent')
  async acceptPrivacyConsent(
    @Body('consentToken') consentToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { accessToken, refreshToken } =
        await this.authService.acceptPrivacyConsent(consentToken);

      res.cookie('accessToken', accessToken, {
        maxAge: 60 * 30 * 1000, // 30 minutes
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'lax',
      });
      res.cookie('refreshToken', refreshToken, {
        maxAge: 60 * 60 * 1000 * 24 * 14, // 14 days
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'lax',
      });

      return { ok: true };
    } catch (error) {
      Logger.error('Failed to accept privacy consent:', error);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'Failed to accept privacy consent' });
    }
  }

  @Public()
  @Get('verify')
  async verify(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // The new verify logic will be based on the JWT strategy validating the accessToken.
    // The AuthGuard('jwt') will handle it automatically.
    // If the guard passes, it means the user is authenticated.

    const accessToken = req.cookies?.accessToken;
    const refreshToken = req.cookies?.refreshToken;

    if (accessToken) {
      try {
        const user = await this.getUserInfoFromAccessToken(accessToken);

        if (user) {
          return {
            isLogined: true,
            userInfo: user,
          };
        } else {
          res.clearCookie('accessToken');
          if (!refreshToken) {
            res.clearCookie('refreshToken');
            return {
              isLogined: false,
              userInfo: null,
            };
          }
        }
      } catch (error) {
        Logger.warn('Access token invalid or expired. ');
      }
    }

    if (refreshToken) {
      try {
        const newAccessToken =
          await this.authService.refreshAccessToken(refreshToken);
        res.cookie('accessToken', newAccessToken, {
          maxAge: 30 * 60 * 1000,
          httpOnly: true,
          secure: this.configService.get('NODE_ENV') === 'production',
          sameSite: 'lax',
        });

        const user = await this.getUserInfoFromAccessToken(newAccessToken);

        if (user) {
          return {
            isLogined: true,
            userInfo: user,
          };
        } else {
          res.clearCookie('accessToken');
          res.clearCookie('refreshToken');

          return {
            isLogined: false,
            userInfo: null,
          };
        }
      } catch (error) {
        Logger.warn('Could not verify or refresh authentication');

        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        return {
          isLogined: false,
          userInfo: null,
        };
      }
    }

    return {
      isLogined: false,
      userInfo: null,
    };
  }

  private async getUserInfoFromAccessToken(
    accessToken: string,
  ): Promise<IUser | null> {
    try {
      const payload = this.jwtService.verify(accessToken, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
      const user = await this.userPublicService.fetchById(payload.id);
      return user;
    } catch (error) {
      Logger.warn('Failed to get user info from access token', error);
      return null;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.logout(req.cookies.refreshToken);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logout successful' };
  }
}
