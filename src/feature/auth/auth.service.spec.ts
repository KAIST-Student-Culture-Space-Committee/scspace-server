jest.mock('../user/user.public.service', () => ({
  UserPublicService: class {},
}));
jest.mock('../organization/organization.public.service', () => ({
  OrganizationPublicService: class {},
}));
jest.mock('@nestjs/axios', () => ({ HttpService: class {} }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock(
  '@scspace-depot/enums/user.enum',
  () => ({ UserAuthBinaryEnum: { USER: 1 } }),
  { virtual: true },
);
jest.mock(
  'src/db/redis/redis.provider',
  () => ({ REDIS_CLIENT: 'REDIS_CLIENT' }),
  {
    virtual: true,
  },
);

import { UnauthorizedException } from '@nestjs/common';
import { of } from 'rxjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    getdel: jest.fn(),
    eval: jest.fn(),
  };
  const userPublicService = {
    fetchByStudentNumber: jest.fn(),
    fetchByEmail: jest.fn(),
    updateStudentNumber: jest.fn(),
    fetchById: jest.fn(),
    insert: jest.fn(),
  };
  const organizationPublicService = {
    fetchMembersById: jest.fn(),
    insertMember: jest.fn(),
  };
  const jwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    decode: jest.fn(),
  };
  const configValues: Record<string, string> = {
    SSO_URL: 'https://sso.example/authorize',
    CLIENT_ID: 'client-id',
    CLIENT_SECRET: 'client-secret',
    REDIRECT_URI: 'https://app.example/auth/callback',
    SSO_TOKEN_URL: 'https://sso.example/token',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const httpService = { post: jest.fn() };

  function service(): AuthService {
    return new AuthService(
      redis as never,
      userPublicService as never,
      organizationPublicService as never,
      jwtService as never,
      configService as never,
      httpService as never,
    );
  }

  const user = {
    id: 7,
    studentNumber: 20250001,
    type: 1,
    email: 'user@kaist.ac.kr',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue('OK');
    redis.getdel.mockResolvedValue(JSON.stringify({ nonce: 'nonce-1' }));
    redis.get.mockResolvedValue('refresh-token');
    redis.eval.mockResolvedValue(1);
    userPublicService.fetchByStudentNumber.mockResolvedValue(user);
    userPublicService.fetchByEmail.mockResolvedValue(null);
    userPublicService.updateStudentNumber.mockImplementation(
      async (_id: number, studentNumber: number) => ({
        ...user,
        studentNumber,
      }),
    );
    userPublicService.fetchById.mockResolvedValue(user);
    organizationPublicService.fetchMembersById.mockResolvedValue([]);
    organizationPublicService.insertMember.mockResolvedValue(undefined);
    jwtService.decode.mockReturnValue({
      nonce: 'nonce-1',
      user_nm: '홍길동',
      user_eng_nm: 'Hong Gil Dong',
      email: user.email,
      std_no: String(user.studentNumber),
    });
    jwtService.verify.mockReturnValue({ id: user.id });
    jwtService.sign.mockImplementation(
      (_payload: unknown, options: { secret: string }) =>
        options.secret === configValues.JWT_ACCESS_SECRET
          ? 'access-token'
          : 'refresh-token',
    );
    httpService.post.mockReturnValue(of({ data: { id_token: 'id-token' } }));
  });

  it('creates a state and nonce with a ten-minute Redis TTL', async () => {
    const url = await service().getLoginUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://sso.example/authorize',
    );
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      configValues.REDIRECT_URI,
    );
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/);
    expect(parsed.searchParams.get('nonce')).toMatch(/^[a-f0-9]{32}$/);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth-state:[a-f0-9]{32}$/),
      expect.stringMatching(/^\{"nonce":"[a-f0-9]{32}"\}$/),
      'EX',
      600,
    );
  });

  it.each([
    ['missing state', '', 'code'],
    ['missing code', 'state', ''],
  ])(
    'rejects callback with %s before consuming state',
    async (_name, state, code) => {
      await expect(
        service().handleSsoCallback(state, code),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(redis.getdel).not.toHaveBeenCalled();
    },
  );

  it('consumes state exactly once and rejects an invalid nonce', async () => {
    jwtService.decode.mockReturnValueOnce({ nonce: 'different' });

    await expect(service().handleSsoCallback('state', 'code')).rejects.toThrow(
      'Invalid nonce',
    );
    expect(redis.getdel).toHaveBeenCalledWith('oauth-state:state');
  });

  it('rejects a corrupted OAuth state payload', async () => {
    redis.getdel.mockResolvedValueOnce('{not-json');

    await expect(service().handleSsoCallback('state', 'code')).rejects.toThrow(
      'Invalid OAuth state',
    );
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('returns consent_required and stores new SSO users for ten minutes', async () => {
    userPublicService.fetchByStudentNumber.mockResolvedValueOnce(null);

    await expect(
      service().handleSsoCallback('state', 'code'),
    ).resolves.toMatchObject({
      status: 'consent_required',
      consentToken: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(redis.set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^privacy-consent:[a-f0-9]{32}$/),
      expect.stringContaining('studentNumber'),
      'EX',
      600,
    );
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('does not persist NaN when both SSO identifiers are malformed', async () => {
    userPublicService.fetchByStudentNumber.mockResolvedValueOnce(null);
    jwtService.decode.mockReturnValueOnce({
      nonce: 'nonce-1',
      user_nm: '홍길동',
      user_eng_nm: 'Hong Gil Dong',
      email: user.email,
      std_no: 'not-a-number',
      emp_no: 'also-invalid',
    });

    await service().handleSsoCallback('state', 'code');

    const setCalls = redis.set.mock.calls;
    const storedPayload = JSON.parse(setCalls[setCalls.length - 1][1]);
    expect(storedPayload.studentNumber).toBe(1);
    expect(Number.isNaN(storedPayload.studentNumber)).toBe(false);
  });

  it('generates access and refresh tokens for an existing SSO user', async () => {
    await expect(service().handleSsoCallback('state', 'code')).resolves.toEqual(
      {
        status: 'success',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        isNewUser: false,
      },
    );
    expect(redis.set).toHaveBeenCalledWith(
      'rt:7',
      'refresh-token',
      'EX',
      60 * 60 * 24 * 14,
    );
  });

  it('matches an existing user by email and updates a changed student number', async () => {
    userPublicService.fetchByEmail.mockResolvedValueOnce({
      ...user,
      studentNumber: 20240001,
    });

    await expect(service().handleSsoCallback('state', 'code')).resolves.toEqual(
      expect.objectContaining({ status: 'success' }),
    );
    expect(userPublicService.fetchByStudentNumber).not.toHaveBeenCalled();
    expect(userPublicService.updateStudentNumber).toHaveBeenCalledWith(
      user.id,
      user.studentNumber,
    );
  });

  it('refreshes only when the JWT and Redis token both match', async () => {
    await expect(service().refreshAccessToken('refresh-token')).resolves.toBe(
      'access-token',
    );
    expect(jwtService.verify).toHaveBeenCalledWith('refresh-token', {
      secret: configValues.JWT_REFRESH_SECRET,
    });

    redis.get.mockResolvedValueOnce('different-token');
    await expect(service().refreshAccessToken('refresh-token')).rejects.toThrow(
      'invalidated',
    );
  });

  it.each([
    ['empty token', '', 'Refresh token not found.'],
    ['expired token', 'expired', 'Invalid or expired refresh token.'],
  ])('rejects refresh token: %s', async (_name, token, message) => {
    if (token === 'expired') {
      jwtService.verify.mockImplementationOnce(() => {
        throw new Error('expired');
      });
    }
    await expect(service().refreshAccessToken(token)).rejects.toThrow(message);
  });

  it('consumes privacy consent once, creates the user, and adds the default organization', async () => {
    const payload = {
      nameKr: '홍길동',
      email: user.email,
      studentNumber: user.studentNumber,
    };
    redis.getdel.mockResolvedValueOnce(JSON.stringify(payload));
    userPublicService.fetchByStudentNumber.mockResolvedValueOnce(null);
    userPublicService.insert.mockResolvedValueOnce(user);

    await expect(service().acceptPrivacyConsent('consent')).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(redis.getdel).toHaveBeenCalledWith('privacy-consent:consent');
    expect(userPublicService.insert).toHaveBeenCalledWith(payload);
    expect(organizationPublicService.insertMember).toHaveBeenCalledWith(
      1,
      user.id,
    );
  });

  it('rejects a corrupted privacy-consent payload', async () => {
    redis.getdel.mockResolvedValueOnce('{not-json');

    await expect(service().acceptPrivacyConsent('consent')).rejects.toThrow(
      'Invalid consent token',
    );
    expect(userPublicService.insert).not.toHaveBeenCalled();
  });

  it('rejects a non-object privacy-consent payload', async () => {
    redis.getdel.mockResolvedValueOnce('null');

    await expect(service().acceptPrivacyConsent('consent')).rejects.toThrow(
      'Invalid consent token',
    );
  });

  it('rejects missing or already-consumed consent tokens', async () => {
    await expect(service().acceptPrivacyConsent('')).rejects.toThrow(
      'Consent token is missing',
    );
    redis.getdel.mockResolvedValueOnce(null);
    await expect(service().acceptPrivacyConsent('consent')).rejects.toThrow(
      'Invalid or expired consent token',
    );
  });

  it('invalidates the refresh token atomically on logout and tolerates invalid input', async () => {
    await expect(service().logout('refresh-token')).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      1,
      'rt:7',
      'refresh-token',
    );

    await expect(service().logout('')).resolves.toBeUndefined();
    jwtService.verify.mockImplementationOnce(() => {
      throw new Error('invalid');
    });
    await expect(service().logout('invalid')).resolves.toBeUndefined();
  });
});
