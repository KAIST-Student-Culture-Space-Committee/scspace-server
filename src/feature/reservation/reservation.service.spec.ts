jest.mock(
  '@scspace-server/common/utils',
  () => ({
    checkContainAllId: jest.fn(),
    takeAll: jest.fn(() => (value: unknown) => value),
    getString: jest.fn(String),
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/reservation.enum',
  () => ({
    ReservationStateEnum: { GRANT: 1, WAIT: 2, RECEIVED: 3, REJECTED: 4 },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/space.enum',
  () => ({ SpaceTypeEnum: { MIRAE: 6, SUMI: 7, SEMINAR: 3 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/mail.enum',
  () => ({
    ReservationMeta: {
      ReservationPending: { kind: 'pending' },
      ReservationCompleted: { kind: 'confirmed' },
      ReservationApproved: { kind: 'approved' },
      ReservationRejected: { kind: 'rejected' },
      WorkerNotif: { kind: 'worker' },
      ReservationUpdated: {},
      ReservationDeleted: {},
    },
    WorkerMeta: { forWorker: {}, forAuthor: {} },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({ UserUtils: { isManager: (type: number) => type === 2 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/mailer/mail.service',
  () => ({ MailService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/reservation/reservation.repository',
  () => ({ ReservationRepository: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/reservation/reservation.public.service',
  () => ({ ReservationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/space/space.public.service',
  () => ({ SpacePublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/user/user.public.service',
  () => ({ UserPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/organization/organization.public.service',
  () => ({ OrganizationPublicService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/reservation/reservation.model',
  () => ({
    MReservation: {
      fromDB: (reservation: object, content: object) => ({
        ...reservation,
        content,
      }),
    },
  }),
  { virtual: true },
);

import { BadRequestException } from '@nestjs/common';
import { ReservationStateEnum } from '@scspace-depot/enums/reservation.enum';
import { SpaceTypeEnum } from '@scspace-depot/enums/space.enum';
import { ReservationService } from './reservation.service';

describe('ReservationService approval lifecycle', () => {
  const reservationRepository = {
    fetch: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    updateApprovalState: jest.fn(),
    fetchContent: jest.fn(),
  };
  const reservationPublicService = {
    checkWholeTime: jest.fn(),
    validateApprovalConstraints: jest.fn(),
    validateSpaceTimeConstraints: jest.fn(),
    validateSeminarLotteryConflict: jest.fn(),
    validatePerformanceLotteryConflict: jest.fn(),
  };
  const spacePublicService = { fetchById: jest.fn() };
  const userPublicService = {
    fetchById: jest.fn(),
    fetchAllWorker: jest.fn(),
  };
  const organizationPublicService = {
    fetchById: jest.fn(),
    fetchByUserId: jest.fn(),
    fetchDeepById: jest.fn(),
  };
  const mailService = {
    sendMail: jest.fn(),
    reportError: jest.fn(),
  };

  function service(): ReservationService {
    return new ReservationService(
      reservationRepository as never,
      reservationPublicService as never,
      spacePublicService as never,
      userPublicService as never,
      organizationPublicService as never,
      mailService as never,
    );
  }

  const content = {
    id: 10,
    description: '',
    innerParticipantNumber: 1,
    outerParticipantNumber: 0,
    food: '',
    busking: false,
    workerNeed: false,
    workerId: 0,
  };
  const input = {
    userId: 7,
    organizationId: 1,
    spaceId: 9,
    title: 'Reservation',
    timeFrom: 1_000,
    timeTo: 1_120,
    content,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userPublicService.fetchById.mockResolvedValue({
      id: 7,
      type: 1,
      email: 'user@example.com',
      nameKr: '예약자',
    });
    organizationPublicService.fetchById.mockResolvedValue({ id: 1 });
    organizationPublicService.fetchByUserId.mockResolvedValue([{ id: 1 }]);
    spacePublicService.fetchById.mockResolvedValue({
      id: 9,
      spaceType: SpaceTypeEnum.MIRAE,
    });
    reservationRepository.insert.mockImplementation(
      async (reservation, state) => [
        { ...reservation, id: 10, state, timePost: 1, timeUpdate: 1 },
        { ...content, ...reservation.content, id: 10 },
      ],
    );
    reservationRepository.fetchContent.mockResolvedValue(content);
    mailService.sendMail.mockResolvedValue(undefined);
    mailService.reportError.mockResolvedValue(undefined);
    userPublicService.fetchAllWorker.mockResolvedValue([]);
  });

  it('creates a normal Mirae Hall reservation in WAIT', async () => {
    await service().postReservation(input, { id: 7, type: 1 } as never);

    expect(reservationRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, spaceId: 9 }),
      ReservationStateEnum.WAIT,
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[SCSpace] Reservation Pending Approval - Reservation',
        context: expect.objectContaining({
          meta: expect.objectContaining({ kind: 'pending' }),
        }),
      }),
    );
  });

  it('creates a manager reservation in GRANT', async () => {
    await service().postReservation(input, { id: 99, type: 2 } as never);

    expect(reservationRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, spaceId: 9 }),
      ReservationStateEnum.GRANT,
    );
  });

  it('sends a WAIT worker reason without notifying all workers before approval', async () => {
    await service().postReservation(
      {
        ...input,
        content: {
          ...content,
          workerNeed: true,
          workerNeedReason: 'Stage setup',
        },
      },
      { id: 7, type: 1 } as never,
    );

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'scspace.kaist@gmail.com',
        subject: '근로 요청 이유: 예약자',
        context: { meta: { description: 'Stage setup' } },
      }),
    );
    expect(mailService.sendMail).not.toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[SCSpace] New Work-Request Reservation Created',
      }),
    );
  });

  it('revalidates a waiting reservation before granting it', async () => {
    const waiting = {
      ...input,
      id: 10,
      state: ReservationStateEnum.WAIT,
      timePost: 1,
      timeUpdate: 1,
    };
    reservationRepository.fetch.mockResolvedValue({ data: [waiting] });
    reservationRepository.updateApprovalState.mockResolvedValue({
      ...waiting,
      state: ReservationStateEnum.GRANT,
    });

    await service().updateReservationApproval({
      id: 10,
      state: ReservationStateEnum.GRANT,
    });

    expect(
      reservationPublicService.validateApprovalConstraints,
    ).toHaveBeenCalledWith(
      7,
      1,
      expect.objectContaining({ id: 9, spaceType: SpaceTypeEnum.MIRAE }),
      1_000,
      1_120,
      10,
    );
    expect(reservationPublicService.checkWholeTime).not.toHaveBeenCalled();
    expect(reservationRepository.updateApprovalState).toHaveBeenCalledWith(
      waiting,
      ReservationStateEnum.GRANT,
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[SCSpace] Reservation Approved - Reservation',
        context: expect.objectContaining({
          meta: expect.objectContaining({ kind: 'approved' }),
        }),
      }),
    );
  });

  it('rejects a waiting reservation without running grant validation', async () => {
    const waiting = {
      ...input,
      id: 10,
      state: ReservationStateEnum.WAIT,
      timePost: 1,
      timeUpdate: 1,
    };
    reservationRepository.fetch.mockResolvedValue({ data: [waiting] });
    reservationRepository.updateApprovalState.mockResolvedValue({
      ...waiting,
      state: ReservationStateEnum.REJECTED,
    });

    await service().updateReservationApproval({
      id: 10,
      state: ReservationStateEnum.REJECTED,
    });

    expect(
      reservationPublicService.validateApprovalConstraints,
    ).not.toHaveBeenCalled();
    expect(reservationRepository.updateApprovalState).toHaveBeenCalledWith(
      waiting,
      ReservationStateEnum.REJECTED,
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[SCSpace] Reservation Rejected - Reservation',
        context: expect.objectContaining({
          meta: expect.objectContaining({ kind: 'rejected' }),
        }),
      }),
    );
  });

  it('does not accept WAIT or RECEIVED as an approval result', async () => {
    await expect(
      service().updateReservationApproval({
        id: 10,
        state: ReservationStateEnum.WAIT as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(reservationRepository.fetch).not.toHaveBeenCalled();
  });

  it('returns a granted hall reservation to WAIT when a member changes its time', async () => {
    const granted = {
      ...input,
      id: 10,
      state: ReservationStateEnum.GRANT,
      timePost: 1,
      timeUpdate: 1,
    };
    reservationRepository.fetch.mockResolvedValue({ data: [granted] });
    reservationRepository.update.mockResolvedValue([
      { ...granted, timeFrom: 1_060, state: ReservationStateEnum.WAIT },
      content,
    ]);

    await service().updateReservation(
      { id: 10, timeFrom: 1_060, timeTo: 1_120 },
      { id: 7, type: 1 } as never,
    );

    expect(reservationRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, timeFrom: 1_060, timeTo: 1_120 }),
      ReservationStateEnum.WAIT,
      granted,
    );
  });

  it('does not fail approval when both notification and error reporting fail', async () => {
    const waiting = {
      ...input,
      id: 10,
      state: ReservationStateEnum.WAIT,
      timePost: 1,
      timeUpdate: 1,
    };
    const granted = { ...waiting, state: ReservationStateEnum.GRANT };
    reservationRepository.fetch.mockResolvedValue({ data: [waiting] });
    reservationRepository.updateApprovalState.mockResolvedValue(granted);
    mailService.sendMail.mockRejectedValueOnce(new Error('mail failed'));
    mailService.reportError.mockRejectedValueOnce(new Error('report failed'));

    await expect(
      service().updateReservationApproval({
        id: 10,
        state: ReservationStateEnum.GRANT,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ state: ReservationStateEnum.GRANT }),
    );

    expect(reservationRepository.updateApprovalState).toHaveBeenCalledWith(
      waiting,
      ReservationStateEnum.GRANT,
    );
  });

  it('notifies workers only after a WAIT worker request is granted', async () => {
    const waiting = {
      ...input,
      id: 10,
      state: ReservationStateEnum.WAIT,
      timePost: 1,
      timeUpdate: 1,
    };
    reservationRepository.fetch.mockResolvedValue({ data: [waiting] });
    reservationRepository.updateApprovalState.mockResolvedValue({
      ...waiting,
      state: ReservationStateEnum.GRANT,
    });
    reservationRepository.fetchContent.mockResolvedValue({
      ...content,
      workerNeed: true,
    });
    userPublicService.fetchAllWorker.mockResolvedValue([
      { email: 'worker@example.com' },
    ]);

    await service().updateReservationApproval({
      id: 10,
      state: ReservationStateEnum.GRANT,
    });

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['worker@example.com'],
        subject: '[SCSpace] New Work-Request Reservation Created',
        context: expect.objectContaining({ workerMail: true }),
      }),
    );
  });
});
