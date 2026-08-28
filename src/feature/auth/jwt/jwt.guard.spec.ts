import type { ExecutionContext } from '@nestjs/common';

jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({
    UserUtils: {
      isManager: (type: number) => type === 2,
      isPasspinMaster: jest.fn(),
      isAdmin: jest.fn(),
      isWorker: jest.fn(),
    },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/organization/organization.public.service',
  () => ({ OrganizationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/reservation/reservation.public.service',
  () => ({ ReservationPublicService: class {} }),
  { virtual: true },
);

import { DelegatorGuard, MemberGuard } from './jwt.guard';

describe('MemberGuard', () => {
  const organizationPublicService = {
    fetchMembersById: jest.fn(),
  };
  const passportGuardPrototype = Object.getPrototypeOf(MemberGuard.prototype);

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(passportGuardPrototype, 'canActivate')
      .mockImplementation(async () => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function context(request: object): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  it('rejects an individual reservation attributed to another user', async () => {
    const guard = new MemberGuard(organizationPublicService as never);

    await expect(
      guard.canActivate(
        context({
          params: {},
          body: { organizationId: 1, userId: 9 },
          user: { id: 7, type: 1 },
        }),
      ),
    ).resolves.toBe(false);
    expect(organizationPublicService.fetchMembersById).not.toHaveBeenCalled();
  });
});

describe('DelegatorGuard', () => {
  const organizationPublicService = {
    fetchById: jest.fn(),
  };
  const passportGuardPrototype = Object.getPrototypeOf(
    DelegatorGuard.prototype,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(passportGuardPrototype, 'canActivate')
      .mockImplementation(async () => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function context(request: object): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  it('uses body.organizationId when the route has no organization param', async () => {
    organizationPublicService.fetchById.mockResolvedValue({ delegatorId: 7 });
    const guard = new DelegatorGuard(organizationPublicService as never);

    await expect(
      guard.canActivate(
        context({
          params: {},
          body: { organizationId: 12 },
          user: { id: 7, type: 1 },
        }),
      ),
    ).resolves.toBe(true);
    expect(organizationPublicService.fetchById).toHaveBeenCalledWith(12);
  });

  it('does not allow body.organizationId to override params.id', async () => {
    organizationPublicService.fetchById.mockResolvedValue({ delegatorId: 7 });
    const guard = new DelegatorGuard(organizationPublicService as never);

    await guard.canActivate(
      context({
        params: { id: '21' },
        body: { organizationId: 12 },
        user: { id: 7, type: 1 },
      }),
    );

    expect(organizationPublicService.fetchById).toHaveBeenCalledWith(21);
  });

  it('rejects invalid organization ids before querying', async () => {
    const guard = new DelegatorGuard(organizationPublicService as never);

    await expect(
      guard.canActivate(
        context({
          params: {},
          body: { organizationId: '12invalid' },
          user: { id: 7, type: 1 },
        }),
      ),
    ).resolves.toBe(false);
    expect(organizationPublicService.fetchById).not.toHaveBeenCalled();
  });

  it('keeps the manager override', async () => {
    const guard = new DelegatorGuard(organizationPublicService as never);

    await expect(
      guard.canActivate(
        context({ params: {}, body: {}, user: { id: 1, type: 2 } }),
      ),
    ).resolves.toBe(true);
    expect(organizationPublicService.fetchById).not.toHaveBeenCalled();
  });
});
