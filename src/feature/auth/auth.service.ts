import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { IUser, IUserCreate } from '@scspace-depot/types/user';
import { UserSSOType2025 } from '@scspace-depot/types/user/user.sso.type';
import { UserAuthBinaryEnum } from '@scspace-depot/enums/user.enum';
import { UserPublicService } from '../user/user.public.service';
import { OrganizationPublicService } from '../organization/organization.public.service';
import { REDIS_CLIENT } from 'src/db/redis/redis.provider';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AuthService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly userPublicService: UserPublicService,
    private readonly organizationPublicService: OrganizationPublicService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async getLoginUrl(): Promise<string> {
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    const key = `oauth-state:${state}`;
    await this.redisClient.set(key, JSON.stringify({ nonce }), 'EX', 600);

    const url = new URL(this.configService.get('SSO_URL'));
    url.searchParams.set('client_id', this.configService.get('CLIENT_ID'));
    url.searchParams.set(
      'redirect_uri',
      this.configService.get('REDIRECT_URI'),
    );

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);

    return url.toString();
  }

  async handleSsoCallback(
    state: string,
    code: string,
  ): Promise<
    | {
        status: 'success';
        accessToken: string;
        refreshToken: string;
        isNewUser: boolean;
      }
    | {
        status: 'consent_required';
        consentToken: string;
      }
  > {
    if (!state || !code) {
      throw new UnauthorizedException('State or code is missing');
    }

    const stateDataStr = await this.redisClient.getdel(`oauth-state:${state}`);
    if (!stateDataStr) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    let nonce: unknown;
    try {
      ({ nonce } = JSON.parse(stateDataStr));
    } catch {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (typeof nonce !== 'string' || nonce.length === 0) {
      throw new UnauthorizedException('Invalid OAuth state');
    }

    const tokenResponse = await this._exchangeCodeForToken(code); // get info

    const idTokenPayload = this._decodeIdToken(tokenResponse.id_token);

    if (idTokenPayload.nonce !== nonce) {
      throw new UnauthorizedException('Invalid nonce');
    }

    const ssoUser = idTokenPayload as unknown as UserSSOType2025;
    const userCreatePayload = this._ssoToUser(ssoUser);

    const user = await this.userPublicService.fetchByStudentNumber(
      userCreatePayload.studentNumber,
    );

    const isNewUser = false;

    if (!user) {
      const consentToken = randomBytes(16).toString('hex');
      await this.redisClient.set(
        `privacy-consent:${consentToken}`,
        JSON.stringify(userCreatePayload),
        'EX',
        600,
      ); // 10분 동안 유효한 토큰 저장
      return { status: 'consent_required', consentToken };
    }

    const accessToken = await this._generateAccessToken(user);
    const refreshToken = await this._generateRefreshToken(user);

    return { status: 'success', accessToken, refreshToken, isNewUser };
  }

  private async _completeLoginWithUserCreatePayload(
    userCreatePayload: ReturnType<AuthService['_ssoToUser']>,
  ): Promise<{
    user: Awaited<ReturnType<UserPublicService['insert']>>;
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  }> {
    let user = await this.userPublicService.fetchByStudentNumber(
      userCreatePayload.studentNumber,
    );

    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      user = await this.userPublicService.insert(userCreatePayload);

      const memberExist =
        await this.organizationPublicService.fetchMembersById(1);

      if (!memberExist.some((member) => member.userId === user.id)) {
        await this.organizationPublicService.insertMember(1, user.id);
      }
    }

    Logger.log('User logged in:', {
      id: user.id,
      studentNumber: user.studentNumber,
    });

    const accessToken = await this._generateAccessToken(user);
    const refreshToken = await this._generateRefreshToken(user);

    return {
      user,
      accessToken,
      refreshToken,
      isNewUser,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found.');
    }
    let payload;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const storedToken = await this.redisClient.get(`rt:${payload.id}`);
    if (storedToken !== refreshToken) {
      throw new UnauthorizedException('Refresh token has been invalidated.');
    }

    const user = await this.userPublicService.fetchById(payload.id);
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return this._generateAccessToken(user);
  }

  async acceptPrivacyConsent(consentToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    if (!consentToken) {
      throw new UnauthorizedException('Consent token is missing');
    }

    const key = this._getPrivacyConsentRedisKey(consentToken);

    const userCreatePayloadStr = await this.redisClient.getdel(key);

    if (!userCreatePayloadStr) {
      throw new UnauthorizedException('Invalid or expired consent token');
    }

    let userCreatePayload: IUserCreate;
    try {
      const parsedPayload: unknown = JSON.parse(userCreatePayloadStr);
      if (
        !parsedPayload ||
        typeof parsedPayload !== 'object' ||
        !Number.isSafeInteger(
          (parsedPayload as Partial<IUserCreate>).studentNumber,
        )
      ) {
        throw new Error('Invalid payload');
      }
      userCreatePayload = parsedPayload as IUserCreate;
    } catch {
      throw new UnauthorizedException('Invalid consent token');
    }

    let user = await this.userPublicService.fetchByStudentNumber(
      userCreatePayload.studentNumber,
    );

    if (!user) {
      user = await this.userPublicService.insert(userCreatePayload);

      const memberExist =
        await this.organizationPublicService.fetchMembersById(1);

      if (!memberExist.some((member) => member.userId === user.id)) {
        await this.organizationPublicService.insertMember(1, user.id);
      }
    }

    const accessToken = await this._generateAccessToken(user);
    const refreshToken = await this._generateRefreshToken(user);

    return {
      accessToken,
      refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) {
      Logger.warn('Logout attempted without refresh token');
      return;
    }
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
      const key = `rt:${payload.id}`;
      await this.redisClient.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
        1,
        key,
        refreshToken,
      );
    } catch (error) {
      Logger.warn('Could not invalidate non-existent or invalid refresh token');
    }
  }

  private async _exchangeCodeForToken(
    code: string,
  ): Promise<{ id_token: string }> {
    const url = this.configService.get<string>('SSO_TOKEN_URL');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.configService.get<string>('CLIENT_ID'),
      client_secret: this.configService.get<string>('CLIENT_SECRET'),
      redirect_uri: this.configService.get<string>('REDIRECT_URI'),
      code: code,
    });

    const response = await firstValueFrom(
      this.httpService.post<{ id_token: string }>(url, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );
    return response.data;
  }

  private _getPrivacyConsentRedisKey(consentToken: string): string {
    return `privacy-consent:${consentToken}`;
  }

  private _decodeIdToken(token: string): Record<string, unknown> {
    try {
      const payload = this.jwtService.decode(token);
      if (!payload || typeof payload !== 'object') throw new Error();
      return payload as Record<string, unknown>;
    } catch (e) {
      throw new UnauthorizedException('Failed to decode ID token');
    }
  }

  private async _generateAccessToken(user: IUser): Promise<string> {
    const payload = {
      id: user.id,
      studentNumber: user.studentNumber,
      type: user.type,
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: '30m',
    });
  }

  private async _generateRefreshToken(user: IUser): Promise<string> {
    const payload = { id: user.id };
    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '14d',
    });
    await this.redisClient.set(`rt:${user.id}`, token, 'EX', 60 * 60 * 24 * 14); // 14 days
    return token;
  }

  private _ssoToUser(ssoPayload: UserSSOType2025): IUserCreate {
    const studentNumber = Number.parseInt(ssoPayload.std_no, 10);
    const employeeNumber = Number.parseInt(ssoPayload.emp_no, 10);

    return {
      nameKr: ssoPayload.user_nm,
      nameEn: ssoPayload.user_eng_nm,
      email: ssoPayload.email,
      type: UserAuthBinaryEnum.USER,
      studentNumber: Number.isSafeInteger(studentNumber)
        ? studentNumber
        : Number.isSafeInteger(employeeNumber)
          ? employeeNumber
          : 1,
    };
  }
}
