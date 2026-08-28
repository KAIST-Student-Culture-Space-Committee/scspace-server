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
jest.mock('./lottery.seminar.service', () => ({
  LotterySeminarService: class {},
}));
jest.mock('./lottery.seminar.repository', () => ({
  LotterySeminarRepository: class {},
}));

import { ForbiddenException } from '@nestjs/common';
import { LotterySeminarController } from './lottery.seminar.controller';

describe('LotterySeminarController authorization', () => {
  const service = {
    postSeminarLottery: jest.fn(),
    deleteSeminarLottery: jest.fn(),
    getActiveSeminarLotteryInfo: jest.fn(),
    drawing: jest.fn(),
    applySeminarLottery: jest.fn(),
  };
  const repository = { fetch: jest.fn() };
  const organizationPublicService = { fetchById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service.postSeminarLottery.mockResolvedValue({ id: 1 });
    service.deleteSeminarLottery.mockResolvedValue(true);
    service.getActiveSeminarLotteryInfo.mockResolvedValue([{ id: 5 }]);
    service.drawing.mockResolvedValue(true);
    service.applySeminarLottery.mockResolvedValue([]);
  });

  function controller(): LotterySeminarController {
    return new LotterySeminarController(
      service as never,
      repository as never,
      organizationPublicService as never,
    );
  }

  it('forwards only allowed create fields', async () => {
    await controller().postSeminarLottery({
      infoId: 1,
      organizationId: 2,
      spaceId: 3,
      priority: 2,
      time: 4,
      lotteryWin: 1,
      userId: 999,
    } as never);

    expect(service.postSeminarLottery).toHaveBeenCalledWith({
      lottery: {
        infoId: 1,
        organizationId: 2,
        spaceId: 3,
        priority: 2,
        time: 4,
      },
    });
  });

  it('forwards the selected lottery info id when drawing', async () => {
    await expect(controller().drawInfo(77)).resolves.toEqual({ success: true });

    expect(service.drawing).toHaveBeenCalledWith(77);
  });

  it('forwards the selected lottery info id when applying', async () => {
    await expect(controller().applyInfo(77)).resolves.toEqual([]);

    expect(service.applySeminarLottery).toHaveBeenCalledWith(77);
  });

  it('allows only the verified organization delegator to delete', async () => {
    repository.fetch.mockResolvedValue([{ organizationId: 2, infoId: 5 }]);
    organizationPublicService.fetchById.mockResolvedValue({
      id: 2,
      delegatorId: 7,
      status: 1,
    });

    await expect(
      controller().deleteSeminarLottery(10, {
        user: { id: 7, type: 1 },
      } as never),
    ).resolves.toEqual({ success: true });
    expect(service.deleteSeminarLottery).toHaveBeenCalledWith(10);
  });

  it('rejects another user and keeps the manager override', async () => {
    repository.fetch.mockResolvedValue([{ organizationId: 2, infoId: 5 }]);
    organizationPublicService.fetchById.mockResolvedValue({
      id: 2,
      delegatorId: 7,
      status: 1,
    });

    await expect(
      controller().deleteSeminarLottery(10, {
        user: { id: 8, type: 1 },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller().deleteSeminarLottery(10, {
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
      controller().deleteSeminarLottery(10, {
        user: { id: 7, type: 1 },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.deleteSeminarLottery).not.toHaveBeenCalled();
  });
});
