jest.mock(
  '@scspace-server/common/utils',
  () => ({
    getDateBegin: jest.fn((value: number) => value),
    getDateDiffInMinute: jest.fn(
      (before: number, after: number) => after - before,
    ),
    getDateEnd: jest.fn((value: number) => value),
    getDateString: jest.fn((value: number) => String(value)),
    getNow: jest.fn(() => 500),
    getRandomIndex: jest.fn(() => 0),
    addLegacyTimeDays: jest.fn(
      (value: number, days: number) => value + days * 24 * 60,
    ),
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/organization.enum',
  () => ({ OrganizationStatusEnum: { VERIFIED: 1 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/space.enum',
  () => ({ SpaceTypeEnum: { MIRAE: 1, SUMI: 2, SEMINAR: 3 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/mail.enum',
  () => ({ LotteryMeta: { Performance: { Win: {}, Lost: {} } } }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/organization/organization.public.service',
  () => ({ OrganizationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/space/space.public.service',
  () => ({ SpacePublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/reservation/reservation.public.service',
  () => ({ ReservationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/mailer/mail.service',
  () => ({ MailService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/user/user.public.service',
  () => ({ UserPublicService: class {} }),
  { virtual: true },
);
jest.mock('./lottery.performance.repository', () => ({
  LotteryPerformanceRepository: class {},
}));
jest.mock('./lottery.performance.info.repository', () => ({
  LotteryPerformanceInfoRepository: class {},
}));
jest.mock('./lottery.performance.model', () => ({
  MPerformanceLottery: class {},
}));
jest.mock('./lottery.performance.info.model', () => ({
  MPerformanceLotteryInfo: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';
import { SpaceTypeEnum } from '@scspace-depot/enums/space.enum';
import { LotteryPerformanceService } from './lottery.performance.service';

describe('LotteryPerformanceService', () => {
  const organizationPublicService = {
    fetchById: jest.fn(),
    fetchVerified: jest.fn(),
  };
  const spacePublicService = {
    fetchById: jest.fn(),
    fetchAllBySpaceType: jest.fn(),
  };
  const lotteryPerformanceRepository = {
    fetch: jest.fn(),
    insert: jest.fn(),
  };
  const lotteryPerformanceInfoRepository = {
    fetch: jest.fn(),
    fetchOpenLotteries: jest.fn(),
    fetchAwaitingApplication: jest.fn(),
    update: jest.fn(),
  };
  const reservationPublicService = {
    getReservationTimesBySpaceIDBetweenTime: jest.fn(),
    postMultipleReservation: jest.fn(),
  };

  function service(): LotteryPerformanceService {
    return new LotteryPerformanceService(
      organizationPublicService as never,
      spacePublicService as never,
      lotteryPerformanceRepository as never,
      lotteryPerformanceInfoRepository as never,
      reservationPublicService as never,
      {} as never,
      {} as never,
    );
  }

  const start = 0;
  const end = start + 24 * 60;
  const lotteryInfo = {
    id: 77,
    timeLotteryStart: 100,
    timeLotteryEnd: 200,
    timeStart: start,
    timeEnd: end - 1,
    applied: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    organizationPublicService.fetchById.mockResolvedValue({
      id: 20,
      status: OrganizationStatusEnum.VERIFIED,
    });
    lotteryPerformanceInfoRepository.fetchOpenLotteries.mockResolvedValue([
      lotteryInfo,
    ]);
    spacePublicService.fetchById.mockResolvedValue({
      id: 10,
      spaceType: SpaceTypeEnum.MIRAE,
    });
    lotteryPerformanceRepository.fetch.mockResolvedValue([]);
    lotteryPerformanceRepository.insert.mockResolvedValue({ id: 1 });
  });

  it.each([
    {
      name: 'priority below the supported range',
      lottery: { priority: 0, date: 0, spaceId: 10 },
      message: 'Priority must be an integer between 1 and 3',
    },
    {
      name: 'negative date',
      lottery: { priority: 1, date: -1, spaceId: 10 },
      message: 'Date must be a non-negative integer',
    },
  ])('rejects $name', async ({ lottery, message }) => {
    await expect(
      service().postPerformanceLottery({
        lottery: {
          infoId: 77,
          organizationId: 20,
          ...lottery,
        },
      } as never),
    ).rejects.toThrow(message);
    expect(lotteryPerformanceRepository.insert).not.toHaveBeenCalled();
  });

  it('rejects a non-performance space', async () => {
    spacePublicService.fetchById.mockResolvedValue({
      id: 10,
      spaceType: SpaceTypeEnum.SEMINAR,
    });

    await expect(
      service().postPerformanceLottery({
        lottery: {
          infoId: 77,
          organizationId: 20,
          priority: 1,
          date: 0,
          spaceId: 10,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lotteryPerformanceRepository.insert).not.toHaveBeenCalled();
  });

  it('rejects a date outside the configured lottery period', async () => {
    await expect(
      service().postPerformanceLottery({
        lottery: {
          infoId: 77,
          organizationId: 20,
          priority: 1,
          date: 1,
          spaceId: 10,
        },
      }),
    ).rejects.toThrow('Date is outside the performance lottery period');
    expect(lotteryPerformanceRepository.insert).not.toHaveBeenCalled();
  });

  it('queries winners only and creates only valid gaps around sorted occupied ranges', async () => {
    lotteryPerformanceInfoRepository.fetchAwaitingApplication.mockResolvedValue(
      [lotteryInfo],
    );
    spacePublicService.fetchAllBySpaceType.mockImplementation(
      async (spaceType: number) =>
        spaceType === SpaceTypeEnum.MIRAE ? [{ id: 10 }] : [],
    );
    lotteryPerformanceRepository.fetch.mockResolvedValue([
      {
        id: 1,
        infoId: 77,
        organizationId: 20,
        spaceId: 10,
        priority: 1,
        date: 0,
        lotteryWin: 1,
      },
    ]);
    organizationPublicService.fetchVerified.mockResolvedValue([
      { id: 20, name: 'Performance Org' },
    ]);
    reservationPublicService.getReservationTimesBySpaceIDBetweenTime.mockResolvedValue(
      [
        { timeFrom: start - 30, timeTo: start + 60 },
        { timeFrom: start + 120, timeTo: start + 180 },
        { timeFrom: start + 150, timeTo: start + 240 },
        { timeFrom: start + 600, timeTo: start + 720 },
        { timeFrom: end - 60, timeTo: end + 30 },
      ],
    );
    reservationPublicService.postMultipleReservation.mockResolvedValue({
      result: [],
    });
    lotteryPerformanceInfoRepository.update.mockResolvedValue({
      ...lotteryInfo,
      applied: true,
    });

    await service().applyPerformanceLottery();

    expect(lotteryPerformanceRepository.fetch).toHaveBeenCalledWith({
      infoId: 77,
      lotteryWin: 1,
    });
    expect(
      reservationPublicService.getReservationTimesBySpaceIDBetweenTime,
    ).toHaveBeenCalledWith(10, start, end);
    const request =
      reservationPublicService.postMultipleReservation.mock.calls[0][0];
    expect(request.time).toEqual([
      { timeFrom: start + 60, timeTo: start + 120 },
      { timeFrom: start + 240, timeTo: start + 600 },
      { timeFrom: start + 720, timeTo: end - 60 },
    ]);
    expect(
      request.time.every(
        ({ timeFrom, timeTo }: { timeFrom: number; timeTo: number }) =>
          timeFrom < timeTo,
      ),
    ).toBe(true);
    expect(lotteryPerformanceInfoRepository.update).toHaveBeenCalledWith({
      id: 77,
      updateLotteryInfo: { applied: true },
    });
  });

  it('does not overlap concurrent drawing runs in the same process', async () => {
    lotteryPerformanceInfoRepository.fetchOpenLotteries.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve([lotteryInfo]), 10)),
    );
    spacePublicService.fetchAllBySpaceType.mockResolvedValue([]);

    const instance = service();
    const first = instance.drawing();
    await expect(instance.drawing()).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
  });
});
