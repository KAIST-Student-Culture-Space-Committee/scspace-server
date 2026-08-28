jest.mock(
  '@scspace-server/common/utils',
  () => ({
    BUSINESS_TIME_ZONE: 'Asia/Seoul',
    getDateBegin: jest.fn((value: number) => value),
    getDateEnd: jest.fn((value: number) => value),
    getDateUnit: jest.fn((value: number) => {
      const minute = value % 60;
      value = Math.floor(value / 60);
      const hour = value % 24;
      value = Math.floor(value / 24);
      const day = value % 32;
      value = Math.floor(value / 32);
      const month = value % 12;
      const year = Math.floor(value / 12);
      return { year, month, day, hour, minute };
    }),
    getNow: jest.fn(() => 500),
    getRandomIndex: jest.fn(() => 0),
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
  () => ({ SpaceTypeEnum: { SEMINAR: 3 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/mail.enum',
  () => ({ LotteryMeta: { Seminar: { Win: {}, Lost: {} } } }),
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
jest.mock('./lottery.seminar.repository', () => ({
  LotterySeminarRepository: class {},
}));
jest.mock('./lottery.seminar.info.repository', () => ({
  LotterySeminarInfoRepository: class {},
}));
jest.mock('./lottery.seminar.model', () => ({
  MSeminarLottery: class {},
}));
jest.mock('./lottery.seminar.info.model', () => ({
  MSeminarLotteryInfo: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { getDateUnit } from '@scspace-server/common/utils';
import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';
import { SpaceTypeEnum } from '@scspace-depot/enums/space.enum';
import {
  buildSeminarReservationTimes,
  LotterySeminarService,
  selectSeminarLotteryWinners,
} from './lottery.seminar.service';

function legacyTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return (((year * 12 + month - 1) * 32 + day) * 24 + hour) * 60 + minute;
}

function lottery(params: {
  id: number;
  organizationId: number;
  spaceId: number;
  priority: number;
  time: number;
  lotteryWin?: number;
}) {
  return {
    infoId: 77,
    lotteryWin: 0,
    ...params,
  };
}

function lotteryInfo(id: number) {
  return {
    id,
    applied: false,
    timeLotteryStart: legacyTime(2026, 1, 1),
    timeLotteryEnd: legacyTime(2026, 1, 31, 23, 59),
    timeStart: legacyTime(2026, 2, 2),
    timeEnd: legacyTime(2026, 6, 30, 23, 59),
  };
}

describe('seminar lottery policy', () => {
  it('draws globally by preference and room ownership, with at most one win per organization', () => {
    const lotteries = [
      lottery({ id: 1, organizationId: 1, spaceId: 10, priority: 1, time: 1 }),
      lottery({ id: 2, organizationId: 2, spaceId: 10, priority: 1, time: 1 }),
      lottery({ id: 3, organizationId: 1, spaceId: 11, priority: 2, time: 2 }),
      lottery({ id: 4, organizationId: 3, spaceId: 11, priority: 2, time: 2 }),
      lottery({ id: 5, organizationId: 4, spaceId: 10, priority: 2, time: 3 }),
      lottery({ id: 6, organizationId: 5, spaceId: 10, priority: 1, time: 3 }),
    ];
    const organizations = [
      { id: 1, hasRoom: false },
      { id: 2, hasRoom: true },
      { id: 3, hasRoom: false },
      { id: 4, hasRoom: false },
      { id: 5, hasRoom: true },
    ];

    const winnerIds = selectSeminarLotteryWinners(
      lotteries as never,
      organizations,
      () => 0,
    );

    expect([...winnerIds].sort((a, b) => a - b)).toEqual([1, 4, 6]);
    const winnerOrganizationIds = lotteries
      .filter(({ id }) => winnerIds.has(id))
      .map(({ organizationId }) => organizationId);
    expect(new Set(winnerOrganizationIds).size).toBe(
      winnerOrganizationIds.length,
    );
  });

  it('keeps one existing winner across all seminar rooms and does not draw its other preferences', () => {
    const lotteries = [
      lottery({
        id: 1,
        organizationId: 1,
        spaceId: 10,
        priority: 1,
        time: 1,
        lotteryWin: 1,
      }),
      lottery({ id: 2, organizationId: 1, spaceId: 11, priority: 2, time: 2 }),
      lottery({ id: 3, organizationId: 2, spaceId: 11, priority: 2, time: 2 }),
    ];

    expect(
      [
        ...selectSeminarLotteryWinners(
          lotteries as never,
          [
            { id: 1, hasRoom: false },
            { id: 2, hasRoom: false },
          ],
          () => 0,
        ),
      ].sort((a, b) => a - b),
    ).toEqual([1, 3]);
  });

  it('creates reservations for weeks 1-16 except 7, 8, 15, and 16 from the containing Monday', () => {
    const times = buildSeminarReservationTimes(
      {
        timeStart: legacyTime(2026, 2, 4),
        timeEnd: legacyTime(2026, 6, 30, 23, 59),
      },
      1 * 24 + 10,
    );

    expect(times).toHaveLength(12);
    expect(
      times.map(({ timeFrom }) => {
        const { month, day } = getDateUnit(timeFrom);
        return `${month + 1}-${day}`;
      }),
    ).toEqual([
      '2-2',
      '2-9',
      '2-16',
      '2-23',
      '3-2',
      '3-9',
      '3-30',
      '4-6',
      '4-13',
      '4-20',
      '4-27',
      '5-4',
    ]);
    expect(
      times.every(({ timeFrom, timeTo }) => {
        const from = getDateUnit(timeFrom);
        const to = getDateUnit(timeTo);
        return from.hour === 10 && to.hour === 11;
      }),
    ).toBe(true);
  });

  it('moves a Sunday 23:00 reservation end to Monday without using host time', () => {
    const [first] = buildSeminarReservationTimes(
      {
        timeStart: legacyTime(2026, 3, 30),
        timeEnd: legacyTime(2026, 7, 31, 23, 59),
      },
      23,
    );

    expect(getDateUnit(first.timeFrom)).toMatchObject({
      year: 2026,
      month: 3,
      day: 5,
      hour: 23,
    });
    expect(getDateUnit(first.timeTo)).toMatchObject({
      year: 2026,
      month: 3,
      day: 6,
      hour: 0,
    });
  });
});

describe('LotterySeminarService application validation', () => {
  const organizationPublicService = {
    fetchById: jest.fn(),
    fetchVerified: jest.fn(),
  };
  const spacePublicService = {
    fetchById: jest.fn(),
    fetchAllBySpaceType: jest.fn(),
  };
  const reservationPublicService = {
    postMultipleReservation: jest.fn(),
  };
  const lotterySeminarRepository = {
    fetch: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const lotterySeminarInfoRepository = {
    fetchOpenLotteries: jest.fn(),
    fetchAwaitingApplication: jest.fn(),
    update: jest.fn(),
  };

  function service(): LotterySeminarService {
    return new LotterySeminarService(
      organizationPublicService as never,
      spacePublicService as never,
      reservationPublicService as never,
      lotterySeminarRepository as never,
      lotterySeminarInfoRepository as never,
      {} as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    organizationPublicService.fetchById.mockResolvedValue({
      id: 20,
      status: OrganizationStatusEnum.VERIFIED,
    });
    spacePublicService.fetchById.mockResolvedValue({
      id: 10,
      spaceType: SpaceTypeEnum.SEMINAR,
    });
    lotterySeminarInfoRepository.fetchOpenLotteries.mockResolvedValue([
      { id: 77, applied: false },
    ]);
    lotterySeminarInfoRepository.fetchAwaitingApplication.mockResolvedValue([]);
    lotterySeminarInfoRepository.update.mockResolvedValue({});
    organizationPublicService.fetchVerified.mockResolvedValue([]);
    spacePublicService.fetchAllBySpaceType.mockResolvedValue([]);
    reservationPublicService.postMultipleReservation.mockResolvedValue({
      id: 1,
    });
    lotterySeminarRepository.fetch.mockResolvedValue([]);
    lotterySeminarRepository.insert.mockResolvedValue({ id: 1 });
  });

  it('accepts one application for each priority across both rooms', async () => {
    lotterySeminarRepository.fetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        lottery({
          id: 1,
          organizationId: 20,
          spaceId: 11,
          priority: 1,
          time: 10,
        }),
      ]);

    await expect(
      service().postSeminarLottery({
        lottery: {
          infoId: 77,
          organizationId: 20,
          spaceId: 10,
          priority: 2,
          time: 11,
        },
      }),
    ).resolves.toEqual({ id: 1 });
  });

  it('rejects a duplicate priority even when it uses another room', async () => {
    lotterySeminarRepository.fetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        lottery({
          id: 1,
          organizationId: 20,
          spaceId: 11,
          priority: 1,
          time: 10,
        }),
      ]);

    await expect(
      service().postSeminarLottery({
        lottery: {
          infoId: 77,
          organizationId: 20,
          spaceId: 10,
          priority: 1,
          time: 11,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lotterySeminarRepository.insert).not.toHaveBeenCalled();
  });

  it('removes every other application after one organization wins', async () => {
    const lotteries = [
      lottery({
        id: 1,
        organizationId: 20,
        spaceId: 10,
        priority: 1,
        time: 10,
      }),
      lottery({
        id: 2,
        organizationId: 20,
        spaceId: 11,
        priority: 2,
        time: 11,
      }),
      lottery({
        id: 3,
        organizationId: 21,
        spaceId: 10,
        priority: 1,
        time: 10,
      }),
    ];
    organizationPublicService.fetchVerified.mockResolvedValue([
      { id: 20, hasRoom: false },
      { id: 21, hasRoom: true },
    ]);
    lotterySeminarRepository.fetch.mockResolvedValue(lotteries);
    const seminarService = service();
    const draw = jest
      .spyOn(seminarService, 'drawSeminarLottery')
      .mockResolvedValue();
    const remove = jest
      .spyOn(seminarService, 'deleteSeminarLottery')
      .mockResolvedValue(true);

    await expect(seminarService.drawing()).resolves.toBe(true);

    expect(draw).toHaveBeenCalledWith(1, true);
    expect(remove).toHaveBeenCalledWith(2, false);
    expect(remove).toHaveBeenCalledWith(3, true);
  });

  it('draws the requested closed lottery after its application period', async () => {
    const closedLottery = lotteryInfo(77);
    lotterySeminarInfoRepository.fetchOpenLotteries.mockResolvedValue([]);
    lotterySeminarInfoRepository.fetchAwaitingApplication.mockResolvedValue([
      lotteryInfo(76),
      closedLottery,
    ]);
    organizationPublicService.fetchVerified.mockResolvedValue([
      { id: 20, hasRoom: false },
    ]);
    lotterySeminarRepository.fetch.mockImplementation(async (params) => {
      if (params.infoId === 77) {
        return [
          lottery({
            id: 200,
            organizationId: 20,
            spaceId: 10,
            priority: 1,
            time: 10,
          }),
        ];
      }
      return [];
    });
    const seminarService = service();
    const draw = jest
      .spyOn(seminarService, 'drawSeminarLottery')
      .mockResolvedValue();

    await expect(seminarService.drawing(77)).resolves.toBe(true);

    expect(lotterySeminarRepository.fetch).toHaveBeenCalledWith({ infoId: 77 });
    expect(draw).toHaveBeenCalledWith(200, true);
  });

  it('draws final candidates before creating their reservations', async () => {
    const closedLottery = lotteryInfo(77);
    const candidate = lottery({
      id: 200,
      organizationId: 20,
      spaceId: 10,
      priority: 1,
      time: 10,
    });
    const winner = { ...candidate, lotteryWin: 1 };
    const calls: string[] = [];
    lotterySeminarInfoRepository.fetchAwaitingApplication.mockResolvedValue([
      closedLottery,
    ]);
    organizationPublicService.fetchVerified.mockResolvedValue([
      { id: 20, hasRoom: false, name: 'Test organization' },
    ]);
    spacePublicService.fetchAllBySpaceType.mockResolvedValue([{ id: 10 }]);
    lotterySeminarRepository.fetch.mockImplementation(async (params) => {
      if (params.lotteryWin === 1) {
        return [winner];
      }
      return [candidate];
    });
    reservationPublicService.postMultipleReservation.mockImplementation(
      async () => {
        calls.push('reservation');
        return { id: 1 };
      },
    );
    const seminarService = service();
    jest
      .spyOn(seminarService, 'drawSeminarLottery')
      .mockImplementation(async () => {
        calls.push('draw');
      });

    await seminarService.applySeminarLottery(77);

    expect(calls).toEqual(['draw', 'reservation']);
    expect(lotterySeminarInfoRepository.update).toHaveBeenCalledWith({
      id: 77,
      updateLotteryInfo: { applied: true },
    });
  });

  it('draws every lottery awaiting final processing at midnight', async () => {
    lotterySeminarInfoRepository.fetchAwaitingApplication.mockResolvedValue([
      lotteryInfo(77),
      lotteryInfo(78),
    ]);
    const seminarService = service();
    const draw = jest.spyOn(seminarService, 'drawing').mockResolvedValue(true);

    await expect(seminarService.drawClosedLotteries()).resolves.toBe(true);

    expect(draw).toHaveBeenNthCalledWith(1, 77);
    expect(draw).toHaveBeenNthCalledWith(2, 78);
  });

  it('serializes concurrent draws for the same lottery', async () => {
    const closedLottery = lotteryInfo(77);
    let drawn = false;
    let startFirstDraw!: () => void;
    let releaseFirstDraw!: () => void;
    const firstDrawStarted = new Promise<void>((resolve) => {
      startFirstDraw = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstDraw = resolve;
    });

    lotterySeminarInfoRepository.fetchOpenLotteries.mockResolvedValue([]);
    lotterySeminarInfoRepository.fetchAwaitingApplication.mockResolvedValue([
      closedLottery,
    ]);
    organizationPublicService.fetchVerified.mockResolvedValue([
      { id: 20, hasRoom: false },
    ]);
    lotterySeminarRepository.fetch.mockImplementation(async (params) => {
      if (params.infoId !== 77) {
        return [];
      }
      return [
        lottery({
          id: 200,
          organizationId: 20,
          spaceId: 10,
          priority: 1,
          time: 10,
          lotteryWin: drawn ? 1 : 0,
        }),
      ];
    });
    const seminarService = service();
    const draw = jest
      .spyOn(seminarService, 'drawSeminarLottery')
      .mockImplementation(async () => {
        startFirstDraw();
        await release;
        drawn = true;
      });

    const firstDraw = seminarService.drawing(77);
    await firstDrawStarted;
    const secondDraw = seminarService.drawing(77);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(draw).toHaveBeenCalledTimes(1);

    releaseFirstDraw();
    await expect(Promise.all([firstDraw, secondDraw])).resolves.toEqual([
      true,
      true,
    ]);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('rejects draw and delete requests when the repository returns an empty result', async () => {
    lotterySeminarRepository.fetch.mockResolvedValue([]);
    const seminarService = service();

    await expect(seminarService.drawSeminarLottery(999)).rejects.toThrow(
      'Seminar lottery not found',
    );
    await expect(seminarService.deleteSeminarLottery(999)).rejects.toThrow(
      'Seminar lottery not found',
    );
    expect(lotterySeminarRepository.update).not.toHaveBeenCalled();
    expect(lotterySeminarRepository.delete).not.toHaveBeenCalled();
  });
});
