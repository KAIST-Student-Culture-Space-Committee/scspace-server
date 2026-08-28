jest.mock(
  '../auth/jwt/jwt.guard',
  () => ({
    AdminGuard: class {},
    ManagerGuard: class {},
    MemberGuard: class {},
    MemberGuardWithReservation: class {},
    WorkerGuard: class {},
  }),
  { virtual: true },
);
jest.mock('@nestjs/passport', () => ({ AuthGuard: jest.fn(() => class {}) }), {
  virtual: true,
});
jest.mock('./reservation.service', () => ({ ReservationService: class {} }));
jest.mock('./reservation.public.service', () => ({
  ReservationPublicService: class {},
}));
jest.mock('../space/space.public.service', () => ({
  SpacePublicService: class {},
}));

import { ReservationController } from './reservation.controller';

describe('ReservationController', () => {
  const service = {
    getReservationListByUserId: jest.fn(),
    getWorkHistory: jest.fn(),
    getWorkNeeds: jest.fn(),
    getReservationList: jest.fn(),
    getManageReservation: jest.fn(),
    postReservation: jest.fn(),
    updateReservation: jest.fn(),
    updateReservationApproval: jest.fn(),
    assignWorker: jest.fn(),
    deleteReservation: jest.fn(),
  };
  const publicService = {
    getReservationBySpaceIDBetweenTime: jest.fn(),
    postMultipleReservation: jest.fn(),
  };
  const spaceService = { fetchAll: jest.fn() };

  function controller(): ReservationController {
    return new ReservationController(
      service as never,
      publicService as never,
      spaceService as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    publicService.getReservationBySpaceIDBetweenTime.mockResolvedValue([]);
    publicService.postMultipleReservation.mockResolvedValue({ success: true });
    service.getReservationListByUserId.mockResolvedValue({
      data: [],
      count: 0,
    });
    service.getReservationList.mockResolvedValue({ data: [], count: 0 });
    service.getWorkHistory.mockResolvedValue([]);
    service.getWorkNeeds.mockResolvedValue([]);
    service.getManageReservation.mockResolvedValue([]);
    service.postReservation.mockResolvedValue({ id: 1 });
    service.updateReservation.mockResolvedValue({ id: 1 });
    service.updateReservationApproval.mockResolvedValue({ id: 1 });
    service.assignWorker.mockResolvedValue({ id: 1 });
    service.deleteReservation.mockResolvedValue({ success: true });
  });

  it('forwards optional time bounds for a space calendar query', async () => {
    await expect(
      controller().getReservationBySpaceID(3, 100, 200),
    ).resolves.toEqual([]);
    expect(
      publicService.getReservationBySpaceIDBetweenTime,
    ).toHaveBeenCalledWith(3, 100, 200);
  });

  it('forwards user, organization, and pagination filters', async () => {
    await controller().getReservationListByUserId(7, 8, 20, 40);
    expect(service.getReservationListByUserId).toHaveBeenCalledWith(
      7,
      8,
      20,
      40,
    );

    await controller().getReservationList(8, 20, 40);
    expect(service.getReservationList).toHaveBeenCalledWith(8, 20, 40);
  });

  it('uses the authenticated user for work history and mutation endpoints', async () => {
    const user = { id: 7, type: 1 };
    await controller().getWorkHistory({ user } as never);
    expect(service.getWorkHistory).toHaveBeenCalledWith(7);

    const input = { spaceId: 1, timeFrom: 2, timeTo: 3 };
    await controller().postReservation(input as never, { user } as never);
    expect(service.postReservation).toHaveBeenCalledWith(input, user);

    await controller().updateReservation(input as never, { user } as never);
    expect(service.updateReservation).toHaveBeenCalledWith(input, user);

    await controller().deleteReservation(11, { user } as never);
    expect(service.deleteReservation).toHaveBeenCalledWith(11, user);
  });

  it('delegates worker, approval, and multiple-reservation operations', async () => {
    const input = { id: 1, workerId: 7 };
    await controller().getWorkerNeeds();
    expect(service.getWorkNeeds).toHaveBeenCalled();

    await controller().getManageReservation();
    expect(service.getManageReservation).toHaveBeenCalled();

    await controller().postMultipleReservation(input as never);
    expect(publicService.postMultipleReservation).toHaveBeenCalledWith(input);

    await controller().updateReservationApproval({ id: 1, state: 2 } as never);
    expect(service.updateReservationApproval).toHaveBeenCalledWith({
      id: 1,
      state: 2,
    });

    await controller().updateWorkerReservation(input as never);
    expect(service.assignWorker).toHaveBeenCalledWith(input);
  });

  it('deletes every reservation from every space for the admin cleanup route', async () => {
    const spaces = [{ id: 1 }, { id: 2 }];
    const reservations = [
      { id: 10, user: { id: 7 } },
      { id: 11, user: { id: 8 } },
    ];
    spaceService.fetchAll.mockResolvedValue(spaces);
    publicService.getReservationBySpaceIDBetweenTime
      .mockResolvedValueOnce(reservations)
      .mockResolvedValueOnce([]);

    await expect(controller().deleteAllReservation()).resolves.toEqual({
      success: true,
    });
    expect(
      publicService.getReservationBySpaceIDBetweenTime,
    ).toHaveBeenNthCalledWith(1, 1);
    expect(
      publicService.getReservationBySpaceIDBetweenTime,
    ).toHaveBeenNthCalledWith(2, 2);
    expect(service.deleteReservation).toHaveBeenNthCalledWith(
      1,
      10,
      reservations[0].user,
    );
    expect(service.deleteReservation).toHaveBeenNthCalledWith(
      2,
      11,
      reservations[1].user,
    );
  });
});
