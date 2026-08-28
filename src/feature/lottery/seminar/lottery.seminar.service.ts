import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OrganizationPublicService } from '@scspace-server/feature/organization/organization.public.service';
import { LotterySeminarRepository } from './lottery.seminar.repository';
import { LotterySeminarInfoRepository } from './lottery.seminar.info.repository';
import { MSeminarLottery } from './lottery.seminar.model';
import { MSeminarLotteryInfo } from './lottery.seminar.info.model';
import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';
import {
  ILotteryInfoCreate,
  ILotteryInfoUpdate,
  ISeminarLotteryCreate,
} from '@scspace-depot/types/lottery';
import {
  BUSINESS_TIME_ZONE,
  getDateBegin,
  getDateEnd,
  getDateUnit,
  getNow,
  getRandomIndex,
} from '@scspace-server/common/utils';
import { Temporal } from '@js-temporal/polyfill';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SpacePublicService } from '@scspace-server/feature/space/space.public.service';
import { SpaceTypeEnum } from '@scspace-depot/enums/space.enum';
import { ReservationPublicService } from '@scspace-server/feature/reservation/reservation.public.service';
import { IReservationMultipleCreateResurt } from '@scspace-depot/types/reservation';
import { MailService } from '@scspace-server/tools/mailer/mail.service';
import { UserPublicService } from '@scspace-server/feature/user/user.public.service';
import { LotteryMeta } from '@scspace-depot/enums/mail.enum';

const weekDays = [
  { key: 'sunday', label: 'Sun', index: 0 },
  { key: 'monday', label: 'Mon', index: 1 },
  { key: 'tuesday', label: 'Tue', index: 2 },
  { key: 'wednesday', label: 'Wed', index: 3 },
  { key: 'thursday', label: 'Thu', index: 4 },
  { key: 'friday', label: 'Fri', index: 5 },
  { key: 'saturday', label: 'Sat', index: 6 },
];

const SEMINAR_LOTTERY_PRIORITIES = [1, 2, 3] as const;
const SEMINAR_RESERVATION_WEEKS = [
  1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14,
] as const;

type SeminarLotteryOrganization = {
  id: number;
  hasRoom: boolean;
};

function getSeminarSlotKey(
  lottery: Pick<MSeminarLottery, 'spaceId' | 'time'>,
): string {
  return `${lottery.spaceId}:${lottery.time}`;
}

function getSeminarLotteryRank(
  lottery: Pick<MSeminarLottery, 'organizationId' | 'priority'>,
  organizations: Map<number, SeminarLotteryOrganization>,
): number {
  const organization = organizations.get(lottery.organizationId);
  return (lottery.priority - 1) * 2 + (organization?.hasRoom ? 1 : 0);
}

export function selectSeminarLotteryWinners(
  lotteries: MSeminarLottery[],
  organizationList: SeminarLotteryOrganization[],
  randomIndex: (length: number) => number = getRandomIndex,
): Set<number> {
  const organizations = new Map(
    organizationList.map((organization) => [organization.id, organization]),
  );
  const winnerIds = new Set<number>();
  const winningOrganizations = new Set<number>();
  const occupiedSlots = new Set<string>();

  const existingWinners = lotteries
    .filter((lottery) => lottery.lotteryWin === 1)
    .sort(
      (a, b) =>
        getSeminarLotteryRank(a, organizations) -
          getSeminarLotteryRank(b, organizations) || a.id - b.id,
    );

  for (const lottery of existingWinners) {
    const slotKey = getSeminarSlotKey(lottery);
    if (
      winningOrganizations.has(lottery.organizationId) ||
      occupiedSlots.has(slotKey)
    ) {
      continue;
    }
    winnerIds.add(lottery.id);
    winningOrganizations.add(lottery.organizationId);
    occupiedSlots.add(slotKey);
  }

  for (const priority of SEMINAR_LOTTERY_PRIORITIES) {
    for (const hasRoom of [false, true]) {
      const lotteriesBySlot = new Map<string, MSeminarLottery[]>();
      for (const lottery of lotteries) {
        const organization = organizations.get(lottery.organizationId);
        const slotKey = getSeminarSlotKey(lottery);
        if (
          lottery.lotteryWin !== 0 ||
          lottery.priority !== priority ||
          organization?.hasRoom !== hasRoom ||
          winningOrganizations.has(lottery.organizationId) ||
          occupiedSlots.has(slotKey)
        ) {
          continue;
        }
        const candidates = lotteriesBySlot.get(slotKey) ?? [];
        candidates.push(lottery);
        lotteriesBySlot.set(slotKey, candidates);
      }

      for (const [slotKey, candidates] of lotteriesBySlot) {
        const eligibleCandidates = candidates.filter(
          (lottery) => !winningOrganizations.has(lottery.organizationId),
        );
        if (eligibleCandidates.length === 0 || occupiedSlots.has(slotKey)) {
          continue;
        }
        const winner =
          eligibleCandidates[randomIndex(eligibleCandidates.length)];
        winnerIds.add(winner.id);
        winningOrganizations.add(winner.organizationId);
        occupiedSlots.add(slotKey);
      }
    }
  }

  return winnerIds;
}

function getLegacyTime(dateTime: Temporal.PlainDateTime): number {
  return (
    (((dateTime.year * 12 + dateTime.month - 1) * 32 + dateTime.day) * 24 +
      dateTime.hour) *
      60 +
    dateTime.minute
  );
}

function getPlainDateTime(time: number): Temporal.PlainDateTime {
  const { year, month, day, hour, minute } = getDateUnit(time);
  return Temporal.PlainDateTime.from({
    year,
    month: month + 1,
    day,
    hour,
    minute,
  });
}

export function buildSeminarReservationTimes(
  lotteryInfo: Pick<MSeminarLotteryInfo, 'timeStart' | 'timeEnd'>,
  encodedTime: number,
): { timeFrom: number; timeTo: number }[] {
  const periodStart = getPlainDateTime(lotteryInfo.timeStart);
  const periodEnd = getPlainDateTime(lotteryInfo.timeEnd);
  const weekOneMonday = periodStart
    .toPlainDate()
    .subtract({ days: periodStart.dayOfWeek - 1 });
  const dayIndex = Math.floor(encodedTime / 24);
  const hour = encodedTime % 24;
  const dayOffsetFromMonday = dayIndex === 0 ? 6 : dayIndex - 1;

  return SEMINAR_RESERVATION_WEEKS.flatMap((weekNumber) => {
    const date = weekOneMonday.add({
      days: (weekNumber - 1) * 7 + dayOffsetFromMonday,
    });
    const timeFrom = date.toPlainDateTime({ hour });
    if (Temporal.PlainDateTime.compare(timeFrom, periodEnd) > 0) {
      return [];
    }
    return [
      {
        timeFrom: getLegacyTime(timeFrom),
        timeTo: getLegacyTime(timeFrom.add({ hours: 1 })),
      },
    ];
  });
}

@Injectable()
export class LotterySeminarService {
  // This service will handle the data access for seminar lottery-related operations
  // Currently, no specific methods are defined
  private readonly lotteryLocks = new Map<number, Promise<void>>();

  constructor(
    private readonly organizationPublicService: OrganizationPublicService,
    private readonly spacePublicService: SpacePublicService,
    @Inject(forwardRef(() => ReservationPublicService))
    private readonly reservationPublicService: ReservationPublicService,
    private readonly lotterySeminarRepository: LotterySeminarRepository,
    private readonly lotterySeminarInfoRepository: LotterySeminarInfoRepository,
    private readonly mailService: MailService,
    private readonly userPublicService: UserPublicService,
  ) {}

  async getAllSeminarLotteryInfo(): Promise<MSeminarLotteryInfo[]> {
    // 자동 정렬된 모든 세미나 추첨 정보 조회
    return await this.lotterySeminarInfoRepository.fetchAll();
  }

  async getActiveSeminarLotteryInfo(): Promise<MSeminarLotteryInfo[]> {
    // 현재 진행 중인 추첨 정보들 조회 (시간 순 정렬)
    const now = getNow();
    return await this.lotterySeminarInfoRepository.fetchOpenLotteries(now);
  }

  async getUpcomingSeminarLotteryInfo(): Promise<MSeminarLotteryInfo[]> {
    // 예정된 추첨 정보들 조회 (시간 순 정렬)
    const now = getNow();
    return await this.lotterySeminarInfoRepository.fetchUpcomingLotteries(now);
  }

  /**
   * 시간 겹침 검증 - 추첨 시작 시간부터 행사 끝 시간까지 겹치는지 확인
   */
  private async validateTimeConflict(
    lotteryInfo: { timeLotteryStart: number; timeEnd: number },
    excludeId?: number,
  ): Promise<void> {
    const allLotteries = await this.lotterySeminarInfoRepository.fetchAll();

    // 현재 수정 중인 항목은 제외
    const otherLotteries = excludeId
      ? allLotteries.filter((lottery) => lottery.id !== excludeId)
      : allLotteries;

    const newStartTime = lotteryInfo.timeLotteryStart;
    const newEndTime = lotteryInfo.timeEnd;

    for (const existingLottery of otherLotteries) {
      const existingStartTime = existingLottery.timeLotteryStart;
      const existingEndTime = existingLottery.timeEnd;

      // 시간 겹침 검사: 새로운 기간과 기존 기간이 겹치는지 확인
      // A: [newStartTime ---- newEndTime]
      // B: [existingStartTime ---- existingEndTime]
      // 겹치지 않는 조건: newEndTime <= existingStartTime OR newStartTime >= existingEndTime
      // 겹치는 조건: !(겹치지 않는 조건)
      const isOverlapping = !(
        newEndTime <= existingStartTime || newStartTime >= existingEndTime
      );

      if (isOverlapping) {
        throw new BadRequestException(
          `Time conflict detected. The period from lottery start to event end overlaps with existing lottery (ID: ${existingLottery.id})`,
        );
      }
    }
  }

  async postSeminarLotteryInfo(params: {
    lotteryInfo: ILotteryInfoCreate;
  }): Promise<MSeminarLotteryInfo> {
    const now = getNow();
    const lotteryInfo = {
      timeStart: getDateBegin(params.lotteryInfo.timeStart),
      timeEnd: getDateEnd(params.lotteryInfo.timeEnd),
      timeLotteryStart: getDateBegin(params.lotteryInfo.timeLotteryStart),
      timeLotteryEnd: getDateEnd(params.lotteryInfo.timeLotteryEnd),
    };

    // 시간 유효성 검증
    if (lotteryInfo.timeLotteryStart < now) {
      throw new BadRequestException('Lottery time cannot be in the past');
    }
    if (lotteryInfo.timeLotteryEnd < lotteryInfo.timeLotteryStart) {
      throw new BadRequestException(
        'Lottery end time cannot be before start time',
      );
    }
    if (lotteryInfo.timeStart < lotteryInfo.timeLotteryEnd) {
      throw new BadRequestException(
        'Start time cannot be before lottery end time',
      );
    }
    if (lotteryInfo.timeEnd < lotteryInfo.timeStart) {
      throw new BadRequestException('Start time cannot be after end time');
    }

    // 시간 겹침 검증
    await this.validateTimeConflict({
      timeLotteryStart: lotteryInfo.timeLotteryStart,
      timeEnd: lotteryInfo.timeEnd,
    });

    // 추첨 정보 생성 (자동 정렬됨)
    return await this.lotterySeminarInfoRepository.insert(lotteryInfo);
  }

  async updateSeminarLotteryInfo(params: {
    id: number;
    updateLotteryInfo: ILotteryInfoUpdate;
  }): Promise<MSeminarLotteryInfo> {
    const seminarLotteryInfo = await this.lotterySeminarInfoRepository.fetch({
      id: params.id,
    });
    if (!seminarLotteryInfo) {
      throw new BadRequestException('Seminar lottery info not found');
    }

    const now = getNow();

    const updateLotteryInfo: ILotteryInfoUpdate = {
      ...params.updateLotteryInfo,
      ...(params.updateLotteryInfo.timeLotteryStart !== undefined
        ? {
            timeLotteryStart: getDateBegin(
              params.updateLotteryInfo.timeLotteryStart,
            ),
          }
        : {}),
      ...(params.updateLotteryInfo.timeLotteryEnd !== undefined
        ? {
            timeLotteryEnd: getDateEnd(params.updateLotteryInfo.timeLotteryEnd),
          }
        : {}),
      ...(params.updateLotteryInfo.timeStart !== undefined
        ? { timeStart: getDateBegin(params.updateLotteryInfo.timeStart) }
        : {}),
      ...(params.updateLotteryInfo.timeEnd !== undefined
        ? { timeEnd: getDateEnd(params.updateLotteryInfo.timeEnd) }
        : {}),
    };

    // 업데이트할 값들을 기존 값과 병합
    const mergedLotteryInfo = {
      timeLotteryStart:
        updateLotteryInfo.timeLotteryStart ??
        seminarLotteryInfo.timeLotteryStart,
      timeLotteryEnd:
        updateLotteryInfo.timeLotteryEnd ?? seminarLotteryInfo.timeLotteryEnd,
      timeStart: updateLotteryInfo.timeStart ?? seminarLotteryInfo.timeStart,
      timeEnd: updateLotteryInfo.timeEnd ?? seminarLotteryInfo.timeEnd,
    };

    // 시간 유효성 검증
    if (mergedLotteryInfo.timeLotteryStart < now) {
      throw new BadRequestException('Lottery time cannot be in the past');
    }
    if (mergedLotteryInfo.timeLotteryEnd < mergedLotteryInfo.timeLotteryStart) {
      throw new BadRequestException(
        'Lottery end time cannot be before start time',
      );
    }
    if (mergedLotteryInfo.timeStart < mergedLotteryInfo.timeLotteryEnd) {
      throw new BadRequestException(
        'Start time cannot be before lottery end time',
      );
    }
    if (mergedLotteryInfo.timeEnd < mergedLotteryInfo.timeStart) {
      throw new BadRequestException('Start time cannot be after end time');
    }

    // 시간 겹침 검증 (현재 수정 중인 항목 제외)
    await this.validateTimeConflict(
      {
        timeLotteryStart: mergedLotteryInfo.timeLotteryStart,
        timeEnd: mergedLotteryInfo.timeEnd,
      },
      params.id,
    );

    // 추첨 정보 업데이트 (자동 정렬됨)
    return await this.lotterySeminarInfoRepository.update({
      id: params.id,
      updateLotteryInfo,
    });
  }

  async deleteSeminarLotteryInfo(id: number): Promise<boolean> {
    const seminarLotteryInfo = await this.lotterySeminarInfoRepository.fetch({
      id,
    });
    if (!seminarLotteryInfo) {
      throw new BadRequestException('Seminar lottery info not found');
    }
    // Implementation for deleting seminar lottery info
    return await this.lotterySeminarInfoRepository.delete(id);
  }

  async getSeminarLotteryByOrganization(params: {
    organizationId: number;
    spaceId?: number;
    infoId: number;
  }): Promise<MSeminarLottery[]> {
    return this.lotterySeminarRepository.fetch(params);
  }

  async getSeminarLotteryByTime(params: {
    time: number;
    spaceId: number;
    infoId: number;
  }): Promise<MSeminarLottery[]> {
    // Implementation for fetching seminar lottery data by time
    return this.lotterySeminarRepository.fetch(params);
  }

  async postSeminarLottery(params: {
    lottery: ISeminarLotteryCreate;
  }): Promise<MSeminarLottery> {
    const organization = await this.organizationPublicService.fetchById(
      params.lottery.organizationId,
    );
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }
    if (organization.status !== OrganizationStatusEnum.VERIFIED) {
      throw new BadRequestException(
        'Only verified organizations can create seminar lotteries',
      );
    }

    if (
      !Number.isSafeInteger(params.lottery.time) ||
      params.lottery.time < 0 ||
      params.lottery.time >= 168
    ) {
      throw new BadRequestException(
        'Time must be an integer between 0 and 167',
      );
    }
    if (
      !Number.isSafeInteger(params.lottery.priority) ||
      params.lottery.priority < 1 ||
      params.lottery.priority > 3
    ) {
      throw new BadRequestException(
        'Priority must be an integer between 1 and 3',
      );
    }

    const space = await this.spacePublicService.fetchById(
      params.lottery.spaceId,
    );
    if (!space || space.spaceType !== SpaceTypeEnum.SEMINAR) {
      throw new BadRequestException(
        'Seminar lotteries are only available for seminar spaces',
      );
    }

    return await this.withLotteryLock(params.lottery.infoId, async () => {
      const activeLotteries =
        await this.lotterySeminarInfoRepository.fetchOpenLotteries(getNow());
      if (!activeLotteries.some(({ id }) => id === params.lottery.infoId)) {
        throw new BadRequestException('Active lottery not found');
      }

      const drawnLotteries = await this.lotterySeminarRepository.fetch({
        spaceId: params.lottery.spaceId,
        time: params.lottery.time,
        infoId: params.lottery.infoId,
        lotteryWin: 1,
      });
      if (drawnLotteries.length > 0) {
        throw new BadRequestException(
          'A seminar lottery with the same time has already been drawn.',
        );
      }

      const pastLotteries = await this.lotterySeminarRepository.fetch({
        organizationId: params.lottery.organizationId,
        infoId: params.lottery.infoId,
      });
      if (pastLotteries.some((lottery) => lottery.lotteryWin === 1)) {
        throw new BadRequestException(
          'Your organization has already won this seminar lottery.',
        );
      }
      if (
        pastLotteries.some(
          (lottery) => lottery.priority === params.lottery.priority,
        )
      ) {
        throw new BadRequestException(
          `Priority ${params.lottery.priority} already has an application.`,
        );
      }
      if (
        pastLotteries.some(
          (lottery) =>
            lottery.spaceId === params.lottery.spaceId &&
            lottery.time === params.lottery.time,
        )
      ) {
        throw new BadRequestException(
          'A seminar lottery for the same room and time already exists.',
        );
      }
      if (pastLotteries.length >= 3) {
        throw new BadRequestException(
          'Maximum number of seminar lottery applications is 3.',
        );
      }
      return await this.lotterySeminarRepository.insert(params.lottery);
    });
  }

  async getSeminarLotteryTimeSlotCounts(param: {
    spaceId: number;
    infoId: number;
  }): Promise<{ time: number; count: number }[]> {
    // 모든 시간대에 대해 신청한 조직 수 반환
    return await this.lotterySeminarRepository.fetchTimeSlotCounts(
      param.spaceId,
      param.infoId,
    );
  }

  async getDrawnSeminarLottery(param: {
    spaceId: number;
    infoId: number;
  }): Promise<MSeminarLottery[]> {
    return await this.lotterySeminarRepository.fetch({
      spaceId: param.spaceId,
      infoId: param.infoId,
      lotteryWin: 1,
    });
  }

  //currently non-usage
  private async timeDecode(
    time: number,
  ): Promise<{ dayIndex: number; hour: number }> {
    const dayIndex = Math.floor(time / 24);
    const hour = time % 24;
    return { dayIndex, hour };
  }

  private async timeDecodeString(
    time: number,
  ): Promise<{ dayString: string; hourString: string }> {
    const dayIndex: number = Math.floor(time / 24);
    const hour: number = time % 24;

    const dayString: string = await this.weekDayDecode(dayIndex);
    const hourString: string = String(hour).padStart(2, '0');

    return {
      dayString,
      hourString,
    };
  }

  private async timeRangeDecodeString(time: number): Promise<{
    dayString: string;
    timeFromString: string;
    timeToString: string;
  }> {
    const timeDecoded = await this.timeDecodeString(time);

    return {
      dayString: timeDecoded.dayString,
      timeFromString: timeDecoded.hourString,
      timeToString: String(parseInt(timeDecoded.hourString) + 1).padStart(
        2,
        '0',
      ),
    };
  }

  private async weekDayDecode(weekDay: number): Promise<string> {
    return weekDays.find((s) => s.index == weekDay).label;
  }

  /**
   * @description "LOST"
   * @param byDraw Check if the action executed by the official draw [optional]
   * @param id Lottery's ID
   * */
  async deleteSeminarLottery(id: number, byDraw?: boolean): Promise<boolean> {
    const seminarLotteryArr = await this.lotterySeminarRepository.fetch({ id });
    if (!seminarLotteryArr || seminarLotteryArr.length === 0) {
      throw new BadRequestException('Seminar lottery not found');
    }
    const seminarLottery = seminarLotteryArr[0];

    const res = await this.lotterySeminarRepository.delete(id);

    //send mail
    if (byDraw) {
      try {
        const [organization, space] = await Promise.all([
          this.organizationPublicService.fetchById(
            seminarLottery.organizationId,
          ),
          this.spacePublicService.fetchById(seminarLottery.spaceId),
        ]);

        const delegator = await this.userPublicService.fetchById(
          organization.delegatorId,
        );

        const timeObj = await this.timeRangeDecodeString(seminarLottery.time);
        const timeStr = `${timeObj.dayString}, ${timeObj.timeFromString}:00 ~ ${timeObj.timeToString}:00`;

        const seminarMeta = { ...LotteryMeta.Seminar.Lost, timeRange: timeStr };

        await this.mailService.sendMail({
          to: delegator.email,
          subject: `[SCSpace] 세미나실 정기예약 추첨 결과 안내`,
          bcc: 'scspace.kaist@gmail.com', //need to check
          template: 'lotteryResult',
          replyTo: 'scspace@kaist.ac.kr',
          context: {
            meta: seminarMeta,
            lottery: seminarLottery,
            space: space,
            organization: organization,
          },
        });
      } catch (error) {
        Logger.error(error);
        await this.mailService.reportError(
          error instanceof Error ? error : new Error(String(error)),
          'deleteSemniarLottery - Mail Sector',
        );
      }
    }

    return res;
  }

  /**
   * @description "WIN"
   * @param byDraw Check if the action executed by the official draw [optional]
   * @param id Lottery's ID
   * */
  async drawSeminarLottery(id: number, byDraw?: boolean): Promise<void> {
    const seminarLotteryArr = await this.lotterySeminarRepository.fetch({ id });
    if (!seminarLotteryArr || seminarLotteryArr.length === 0) {
      throw new BadRequestException('Seminar lottery not found');
    }

    const seminarLottery = seminarLotteryArr[0];
    // Implementation for drawing seminar lottery
    await this.lotterySeminarRepository.update(id, { lotteryWin: 1 });

    Logger.log(`Seminar lottery drawn: ${id}`);

    //send mail
    if (byDraw) {
      try {
        const [organization, space] = await Promise.all([
          this.organizationPublicService.fetchById(
            seminarLottery.organizationId,
          ),
          this.spacePublicService.fetchById(seminarLottery.spaceId),
        ]);

        const delegator = await this.userPublicService.fetchById(
          organization.delegatorId,
        );

        const timeObj = await this.timeRangeDecodeString(seminarLottery.time);
        const timeStr = `${timeObj.dayString}, ${timeObj.timeFromString}:00 ~ ${timeObj.timeToString}:00`;

        const seminarMeta = { ...LotteryMeta.Seminar.Win, timeRange: timeStr };

        await this.mailService.sendMail({
          to: delegator.email,
          subject: `[SCSpace] 세미나실 정기예약 추첨 결과 안내`,
          bcc: 'scspace.kaist@gmail.com', //deprecated
          template: 'lotteryResult',
          replyTo: 'scspace@kaist.ac.kr',
          context: {
            meta: seminarMeta,
            lottery: seminarLottery,
            space: space,
            organization: organization,
          },
        });
      } catch (error) {
        Logger.log(error);
        await this.mailService.reportError(
          error instanceof Error ? error : new Error(String(error)),
          'drawSemniarLottery - Mail Sector',
        );
      }
    }
  }

  private async withLotteryLock<T>(
    infoId: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.lotteryLocks.get(infoId) ?? Promise.resolve();
    let release: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.lotteryLocks.set(infoId, chain);

    await previous;
    try {
      return await operation();
    } finally {
      release!();
      if (this.lotteryLocks.get(infoId) === chain) {
        this.lotteryLocks.delete(infoId);
      }
    }
  }

  private async findLotteryForDrawing(
    infoId?: number,
  ): Promise<MSeminarLotteryInfo | undefined> {
    const now = getNow();
    const [openLotteries, awaitingLotteries] = await Promise.all([
      this.lotterySeminarInfoRepository.fetchOpenLotteries(now),
      this.lotterySeminarInfoRepository.fetchAwaitingApplication(now),
    ]);
    const lotteries = [...openLotteries, ...awaitingLotteries].filter(
      (lottery) => !lottery.applied,
    );

    if (infoId === undefined) {
      return lotteries[0];
    }
    return lotteries.find((lottery) => lottery.id === infoId);
  }

  private async drawLotteryInfo(
    lotteryInfo: MSeminarLotteryInfo,
  ): Promise<void> {
    const verifiedOrganizations =
      await this.organizationPublicService.fetchVerified();
    const lotteries = await this.lotterySeminarRepository.fetch({
      infoId: lotteryInfo.id,
    });
    const existingWinnerIds = new Set(
      lotteries
        .filter((lottery) => lottery.lotteryWin === 1)
        .map((lottery) => lottery.id),
    );
    const winnerIds = selectSeminarLotteryWinners(
      lotteries,
      verifiedOrganizations,
    );
    const winningOrganizationIds = new Set(
      lotteries
        .filter((lottery) => winnerIds.has(lottery.id))
        .map((lottery) => lottery.organizationId),
    );

    for (const lottery of lotteries) {
      if (winnerIds.has(lottery.id) && !existingWinnerIds.has(lottery.id)) {
        await this.drawSeminarLottery(lottery.id, true);
        Logger.log(`Seminar lottery winner drawn: ${lottery.id}`);
      }
    }

    const notifiedLosingOrganizations = new Set<number>();
    for (const lottery of lotteries) {
      if (winnerIds.has(lottery.id)) {
        continue;
      }
      const notifyLoss =
        !winningOrganizationIds.has(lottery.organizationId) &&
        !notifiedLosingOrganizations.has(lottery.organizationId);
      await this.deleteSeminarLottery(lottery.id, notifyLoss);
      if (notifyLoss) {
        notifiedLosingOrganizations.add(lottery.organizationId);
      }
    }
  }

  async applySeminarLottery(
    infoId: number,
  ): Promise<IReservationMultipleCreateResurt[]> {
    return await this.withLotteryLock(infoId, async () => {
      const awaitingLotteries =
        await this.lotterySeminarInfoRepository.fetchAwaitingApplication(
          getNow(),
        );
      const lotteryInfo = awaitingLotteries.find(
        (lottery) => lottery.id === infoId,
      );
      if (!lotteryInfo) {
        throw new BadRequestException('No pending lottery found');
      }

      await this.drawLotteryInfo(lotteryInfo);

      const [verifiedOrganizations, seminarRooms, drawnLotteries] =
        await Promise.all([
          this.organizationPublicService.fetchVerified(),
          this.spacePublicService.fetchAllBySpaceType(SpaceTypeEnum.SEMINAR),
          this.lotterySeminarRepository.fetch({
            infoId: lotteryInfo.id,
            lotteryWin: 1,
          }),
        ]);
      const organizations = new Map(
        verifiedOrganizations.map((organization) => [
          organization.id,
          organization,
        ]),
      );
      const spaces = new Map(seminarRooms.map((space) => [space.id, space]));
      const logs: IReservationMultipleCreateResurt[] = [];

      for (const lottery of drawnLotteries) {
        const organization = organizations.get(lottery.organizationId);
        const space = spaces.get(lottery.spaceId);
        if (!organization || !space) {
          continue;
        }
        const time = buildSeminarReservationTimes(lotteryInfo, lottery.time);
        if (time.length === 0) {
          continue;
        }
        const log = await this.reservationPublicService.postMultipleReservation(
          {
            title: `세미나실 정기예약 [${organization.name}]`,
            spaceId: space.id,
            userId: 1,
            organizationId: organization.id,
            time,
            content: {
              description: `세미나실 정기예약 [${organization.name}]`,
              innerParticipantNumber: 20,
              outerParticipantNumber: 0,
              food: '',
              busking: false,
              workerNeed: false,
            },
          },
        );
        logs.push(log);
      }

      await this.lotterySeminarInfoRepository.update({
        id: lotteryInfo.id,
        updateLotteryInfo: { applied: true },
      });

      return logs;
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_6PM, {
    name: 'drawing',
    timeZone: BUSINESS_TIME_ZONE,
  })
  async drawing(infoId?: number): Promise<boolean> {
    Logger.log('Drawing seminar lottery...');

    const lotteryInfo = await this.findLotteryForDrawing(infoId);
    if (!lotteryInfo) {
      return false;
    }

    return await this.withLotteryLock(lotteryInfo.id, async () => {
      const lockedLotteryInfo = await this.findLotteryForDrawing(
        lotteryInfo.id,
      );
      if (!lockedLotteryInfo) {
        return false;
      }
      await this.drawLotteryInfo(lockedLotteryInfo);
      return true;
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'seminar_final_drawing',
    timeZone: BUSINESS_TIME_ZONE,
  })
  async drawClosedLotteries(): Promise<boolean> {
    const awaitingLotteries =
      await this.lotterySeminarInfoRepository.fetchAwaitingApplication(
        getNow(),
      );
    if (awaitingLotteries.length === 0) {
      return false;
    }

    for (const lotteryInfo of awaitingLotteries) {
      await this.drawing(lotteryInfo.id);
    }

    return true;
  }
}
