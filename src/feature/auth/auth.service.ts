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
    await this.redisClient.set(
      `oauth-state:${state}`,
      JSON.stringify({ nonce }),
      'EX',
      600,
    );

    const saved = await this.redisClient.get(key);

    //console.log('[REDIS SET] Key:', key, 'Value:', saved);

    const url = new URL(this.configService.get('SSO_URL'));
    url.searchParams.set('client_id', this.configService.get('CLIENT_ID'));
    url.searchParams.set(
      'redirect_uri',
      this.configService.get('REDIRECT_URI'),
    );
    //console.log(this.configService.get('REDIRECT_URI'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);

    return url.toString();
  }

  async handleSsoCallback(
    state: string,
    code: string,
  ): Promise<|{
    status : 'success'
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  }|{
    status : 'consent_required'
    consentToken: string;
  }> {
    console.log(state, code);
    if (!state || !code) {
      throw new UnauthorizedException('State or code is missing');
    }
    //console.log("State and code are present");
    const stateDataStr = await this.redisClient.get(`oauth-state:${state}`);
    if (!stateDataStr) {
      throw new UnauthorizedException('Invalid or expired state');
    }
    //console.log("State data found in Redis"); 
    await this.redisClient.del(`oauth-state:${state}`);
    const { nonce } = JSON.parse(stateDataStr);

    const tokenResponse = await this._exchangeCodeForToken(code); // get info
    //console.log("[TOKEN RESPONSE]", tokenResponse);

    const idTokenPayload = this._decodeIdToken(tokenResponse.id_token);
    //console.log("[ID TOKEN PAYLOAD]", JSON.stringify(idTokenPayload,null,2  ));


    if (idTokenPayload.nonce !== nonce) {
      throw new UnauthorizedException('Invalid nonce');
    }

    const ssoUser = idTokenPayload as UserSSOType2025;
    const userCreatePayload = this._ssoToUser(ssoUser);
    //console.log("[USER CREATE PAYLOAD]", JSON.stringify(userCreatePayload,null,2) );

    // break point
    let user = await this.userPublicService.fetchByStudentNumber(
      userCreatePayload.studentNumber,
    );

    let isNewUser = false;
    console.log("user", user);

    if(!user){ // 사실..user가 없으면 privacy consent도 없긴함. 그러면 굳이 userPrivacyConsentRequired에서 user를 찾을 필요 없이, user가 없으면 바로 개인정보 수집 동의 페이지로 보내는 게 나을듯.
      console.log("No user found. User needs to accept privacy consent.");
      const consentToken = randomBytes(16).toString('hex');
      await this.redisClient.set(`privacy-consent:${consentToken}`, JSON.stringify(userCreatePayload), 'EX', 600); // 10분 동안 유효한 토큰 저장
      return { status: 'consent_required', consentToken };
      }
    

    /*
    if (!user) {
      isNewUser = true;
      user = await this.userPublicService.insert(userCreatePayload); // data 넣는 부분
      const memberExist =
        await this.organizationPublicService.fetchMembersById(1);
      if (!memberExist.some((member) => member.userId === user.id)) {
        await this.organizationPublicService.insertMember(1, user.id);
      }
    }

    Logger.log('User logged in:', { id: user.id, studentNumber: user.studentNumber });
    */
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

  let isNewUser = false; // this need?

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
    console.log("iwanna refresh access token");
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

  const key = `privacy-consent:${consentToken}`;

  const userCreatePayloadStr = await this.redisClient.get(key);

  if (!userCreatePayloadStr) {
    throw new UnauthorizedException('Invalid or expired consent token');
  }

  const userCreatePayload = JSON.parse(userCreatePayloadStr);

  let user = await this.userPublicService.fetchByStudentNumber(
    userCreatePayload.studentNumber,
  );


  if (!user) { // probably... not...

    user = await this.userPublicService.insert(userCreatePayload);

    const memberExist =
      await this.organizationPublicService.fetchMembersById(1);

    if (!memberExist.some((member) => member.userId === user.id)) {
      await this.organizationPublicService.insertMember(1, user.id);
    }
  }

  await this.redisClient.del(key);

  const accessToken = await this._generateAccessToken(user);
  const refreshToken = await this._generateRefreshToken(user);

  return {
    accessToken,
    refreshToken,
  };
}

  async logout(refreshToken: string): Promise<void> {
    console.log("imhere");
    if (!refreshToken)
      {
        Logger.warn('Logout attempted without refresh token');
        return;
      }
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
      await this.redisClient.del(`rt:${payload.id}`);
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

 
  private _decodeIdToken(token: string): any {
    try {
      const payload = this.jwtService.decode(token);
      if (!payload) throw new Error();
      return payload;
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
    return {
      nameKr: ssoPayload.user_nm,
      nameEn: ssoPayload.user_eng_nm,
      email: ssoPayload.email,
      type: UserAuthBinaryEnum.USER,
      studentNumber: parseInt(ssoPayload.std_no)
        ? parseInt(ssoPayload.std_no)
        : parseInt(ssoPayload.emp_no) ?? 1,
    };
  }
}
