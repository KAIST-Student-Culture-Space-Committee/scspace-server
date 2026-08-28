jest.mock(
  '@scspace-server/feature/auth/jwt/jwt.guard',
  () => ({ AdminGuard: class {}, DelegatorGuard: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({ UserUtils: { isManager: (type: number) => type === 2 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/organization/organization.public.service',
  () => ({ OrganizationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/organization.enum',
  () => ({ OrganizationStatusEnum: { VERIFIED: 1 } }),
  { virtual: true },
);
jest.mock('./lottery.performance.service', () => ({
  LotteryPerformanceService: class {},
}));
jest.mock('./lottery.performance.repository', () => ({
  LotteryPerformanceRepository: class {},
}));

import { ForbiddenException } from '@nestjs/common';
import { LotteryPerformanceController } from './lottery.performance.controller';

describe('LotteryPerformanceController authorization', () => {
  const service = {
    postPerformanceLottery: jest.fn(),
    deletePerformanceLottery: jest.fn(),
    getActivePerformanceLotteryInfo: jest.fn(),
  };
  const repository = { fetch: jest.fn() };
  const organizationPublicService = { fetchById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service.postPerformanceLottery.mockResolvedValue({ id: 1 });
    service.deletePerformanceLottery.mockResolvedValue(true);
    service.getActivePerformanceLotteryInfo.mockResolvedValue([{ id: 5 }]);
  });

  function controller(): LotteryPerformanceController {
    return new LotteryPerformanceController(
      service as never,
      repository as never,
      organizationPublicService as never,
    );
  }

  it('forwards only allowed create fields', async () => {
    await controller().postPerformanceLottery({
      infoId: 1,
      organizationId: 2,
      spaceId: 3,
      priority: 1,
      date: 4,
      lotteryWin: 1,
      userId: 999,
    } as never);

    expect(service.postPerformanceLottery).toHaveBeenCalledWith({
      lottery: {
        infoId: 1,
        organizationId: 2,
        spaceId: 3,
        priority: 1,
        date: 4,
      },
    });
  });

  it('allows only the verified organization delegator to delete', async () => {
    repository.fetch.mockResolvedValue([{ organizationId: 2, infoId: 5 }]);
    organizationPublicService.fetchById.mockResolvedValue({
      id: 2,
      delegatorId: 7,
      status: 1,
    });

    await expect(
      controller().deletePerformanceLottery(10, {
        user: { id: 7, type: 1 },
      } as never),
    ).resolves.toEqual({ success: true });
    expect(service.deletePerformanceLottery).toHaveBeenCalledWith(10, false);
  });

  it('rejects another user and keeps the manager override', async () => {
    repository.fetch.mockResolvedValue([{ organizationId: 2, infoId: 5 }]);
    organizationPublicService.fetchById.mockResolvedValue({
      id: 2,
      delegatorId: 7,
      status: 1,
    });

    await expect(
      controller().deletePerformanceLottery(10, {
        user: { id: 8, type: 1 },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller().deletePerformanceLottery(10, {
        user: { id: 1, type: 2 },
      } as never),
    ).resolves.toEqual({ success: true });
  });

  it('rejects a delegator whose organization is not verified', async () => {
    repository.fetch.mockResolvedValue([{ organizationId: 2, infoId: 5 }]);
    organizationPublicService.fetchById.mockResolvedValue({
      id: 2,
      delegatorId: 7,
      status: 0,
    });

    await expect(
      controller().deletePerformanceLottery(10, {
        user: { id: 7, type: 1 },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.deletePerformanceLottery).not.toHaveBeenCalled();
  });
});
