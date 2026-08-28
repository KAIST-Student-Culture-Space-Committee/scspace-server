jest.mock('./auth.service', () => ({ AuthService: class {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));
jest.mock('../user/user.public.service', () => ({
  UserPublicService: class {},
}));
jest.mock(
  'src/common/decorators/public.decorator',
  () => ({ Public: () => () => undefined }),
  {
    virtual: true,
  },
);

import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const authService = {
    getLoginUrl: jest.fn(),
    handleSsoCallback: jest.fn(),
    refreshAccessToken: jest.fn(),
    acceptPrivacyConsent: jest.fn(),
    logout: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'NEXT_PUBLIC_APP_URL'
        ? 'https://app.example'
        : key === 'NODE_ENV'
          ? 'test'
          : 'secret',
    ),
  };
  const jwtService = { verify: jest.fn() };
  const userPublicService = { fetchById: jest.fn() };

  function controller(): AuthController {
    return new AuthController(
      authService as never,
      configService as never,
      jwtService as never,
      userPublicService as never,
    );
  }

  function response() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn((value: string) => value),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    authService.getLoginUrl.mockResolvedValue('https://sso.example/login');
    authService.handleSsoCallback.mockResolvedValue({
      status: 'success',
      accessToken: 'access',
      refreshToken: 'refresh',
      isNewUser: false,
    });
    authService.refreshAccessToken.mockResolvedValue('new-access');
    authService.acceptPrivacyConsent.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    authService.logout.mockResolvedValue(undefined);
    jwtService.verify.mockReturnValue({ id: 7 });
    userPublicService.fetchById.mockResolvedValue({ id: 7, type: 1 });
  });

  it('returns the SSO login URL', async () => {
    await expect(controller().getLoginUrl()).resolves.toEqual({
      loginUrl: 'https://sso.example/login',
    });
  });

  it('redirects consent-required and successful callbacks with secure cookies', async () => {
    const consentResponse = response();
    authService.handleSsoCallback.mockResolvedValueOnce({
      status: 'consent_required',
      consentToken: 'consent',
    });
    await controller().ssoCallback('state', 'code', consentResponse as never);
    expect(consentResponse.redirect).toHaveBeenCalledWith(
      'https://app.example/login?privacyConsentRequired=true&token=consent',
    );

    const successResponse = response();
    await controller().ssoCallback('state', 'code', successResponse as never);
    expect(successResponse.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access',
      expect.objectContaining({ httpOnly: true, maxAge: 30 * 60 * 1000 }),
    );
    expect(successResponse.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 60 * 60 * 1000 * 24 * 14,
      }),
    );
    expect(successResponse.redirect).toHaveBeenCalledWith(
      'https://app.example',
    );
  });

  it('converts callback errors to an auth failure redirect', async () => {
    authService.handleSsoCallback.mockRejectedValueOnce(new Error('failed'));
    const res = response();

    await controller().ssoCallback('state', 'code', res as never);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example/login?error=auth_failed',
    );
  });

  it('refreshes access tokens and sets the access cookie', async () => {
    const res = response();
    await expect(
      controller().refreshTokens(
        { cookies: { refreshToken: 'refresh' } } as never,
        res as never,
      ),
    ).resolves.toEqual({ message: 'Access token refreshed' });
    expect(authService.refreshAccessToken).toHaveBeenCalledWith('refresh');
    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'new-access',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('accepts privacy consent or returns a bad request response', async () => {
    const res = response();
    await expect(
      controller().acceptPrivacyConsent('consent', res as never),
    ).resolves.toEqual({
      ok: true,
    });
    expect(res.cookie).toHaveBeenCalledTimes(2);

    authService.acceptPrivacyConsent.mockRejectedValueOnce(
      new Error('expired'),
    );
    const errorResponse = response();
    await controller().acceptPrivacyConsent('expired', errorResponse as never);
    expect(errorResponse.status).toHaveBeenCalledWith(400);
    expect(errorResponse.json).toHaveBeenCalledWith({
      message: 'Failed to accept privacy consent',
    });
  });

  it('verifies an access token, refreshes with a refresh token, and logs out', async () => {
    const verified = await controller().verify(
      { cookies: { accessToken: 'access' } } as never,
      response() as never,
    );
    expect(verified).toEqual({ isLogined: true, userInfo: { id: 7, type: 1 } });

    const refreshResponse = response();
    const refreshed = await controller().verify(
      { cookies: { refreshToken: 'refresh' } } as never,
      refreshResponse as never,
    );
    expect(refreshed).toEqual({
      isLogined: true,
      userInfo: { id: 7, type: 1 },
    });
    expect(authService.refreshAccessToken).toHaveBeenCalledWith('refresh');

    jwtService.verify.mockImplementationOnce(() => {
      throw new Error('expired');
    });
    const expiredResponse = response();
    await expect(
      controller().verify(
        {
          cookies: { accessToken: 'expired', refreshToken: 'refresh' },
        } as never,
        expiredResponse as never,
      ),
    ).resolves.toEqual({ isLogined: true, userInfo: { id: 7, type: 1 } });

    const logoutResponse = response();
    await expect(
      controller().logout(
        { cookies: { refreshToken: 'refresh' } } as never,
        logoutResponse as never,
      ),
    ).resolves.toEqual({ message: 'Logout successful' });
    expect(logoutResponse.clearCookie).toHaveBeenCalledWith('accessToken');
    expect(logoutResponse.clearCookie).toHaveBeenCalledWith('refreshToken');
  });

  it('returns an explicit unauthenticated response without cookies', async () => {
    await expect(
      controller().verify({ cookies: {} } as never, response() as never),
    ).resolves.toEqual({ isLogined: false, userInfo: null });
  });
});
