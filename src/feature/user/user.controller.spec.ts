jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({
    UserUtils: { isManager: (type: number) => type === 2 },
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
jest.mock(
  '@scspace-server/feature/user/user.public.service',
  () => ({
    UserPublicService: class {},
  }),
  { virtual: true },
);
jest.mock('./user.service', () => ({
  UserService: class {},
}));
jest.mock('./user.public.service', () => ({
  UserPublicService: class {},
}));

import { NotFoundException } from '@nestjs/common';
import { UserController } from './user.controller';

describe('UserController', () => {
  const userService = {
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const userPublicService = {
    fetchAll: jest.fn(),
    fetchByStudentNumber: jest.fn(),
    search: jest.fn(),
    fetchById: jest.fn(),
  };

  function controller(): UserController {
    return new UserController(userService as never, userPublicService as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    userPublicService.fetchAll.mockResolvedValue([]);
    userPublicService.search.mockResolvedValue([]);
    userPublicService.fetchById.mockResolvedValue({ id: 11 });
  });

  it('uses default prefix 0 for admin user list', async () => {
    await controller().getUsers();

    expect(userPublicService.fetchAll).toHaveBeenCalledWith(0);
  });

  it('returns empty array and skips search when query is blank', async () => {
    await expect(controller().searchUsers('', 10)).resolves.toEqual([]);
    expect(userPublicService.search).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when student number user is missing', async () => {
    userPublicService.fetchByStudentNumber.mockResolvedValue(undefined);

    await expect(
      controller().getUserByStudentNumber(20280000),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(userPublicService.fetchByStudentNumber).toHaveBeenCalledWith(
      20280000,
    );
  });

  it('returns user for existing student number', async () => {
    const user = { id: 10 };
    userPublicService.fetchByStudentNumber.mockResolvedValue(user);

    await expect(
      controller().getUserByStudentNumber(20280001),
    ).resolves.toEqual(user);
  });

  it('returns user detail by id', async () => {
    await controller().getUserById(10);
    expect(userPublicService.fetchById).toHaveBeenCalledWith(10);
  });

  it('passes new user payload through post user endpoint', async () => {
    const payload = {
      studentNumber: '20260000',
      email: 'a@b.com',
      nameKr: 'A',
    };
    userService.insert.mockResolvedValue({ id: 10, ...payload });

    await expect(controller().postUser(payload as never)).resolves.toEqual({
      id: 10,
      ...payload,
    });
    expect(userService.insert).toHaveBeenCalledWith(payload);
  });

  it('forwards partial updates on patch user type request', async () => {
    const payload = { type: 2 };
    userService.update.mockResolvedValue({ id: 10, type: 2 });

    await expect(
      controller().patchUserType(10, payload as never),
    ).resolves.toEqual({
      id: 10,
      type: 2,
    });
    expect(userService.update).toHaveBeenCalledWith(10, payload);
  });

  it('forwards user removal request to service', async () => {
    userService.delete.mockResolvedValue({ success: true });

    await expect(controller().deleteUser(10)).resolves.toEqual({
      success: true,
    });
    expect(userService.delete).toHaveBeenCalledWith(10);
  });

  it('throws NotFoundException when detail id has no user', async () => {
    userPublicService.fetchById.mockResolvedValue(undefined);

    await expect(controller().getUserById(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
