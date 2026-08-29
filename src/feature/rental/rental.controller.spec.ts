jest.mock('./rental.service', () => ({ RentalService: class {} }));
jest.mock(
  '../auth/jwt/jwt.guard',
  () => ({
    ManagerGuard: class {},
    MemberGuard: class {},
    UserGuard: class {},
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({
    UserUtils: { isManager: (type: number) => type === 2 },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/file/file.storage',
  () => ({ publicStorage: {} }),
  {
    virtual: true,
  },
);

import { RentalController } from './rental.controller';
import { BadRequestException } from '@nestjs/common';
jest.mock(
  '@scspace-depot/enums/rental.enum',
  () => ({
    RentalStatusEnum: {
      ACTIVE: 0,
      RETURNED: 1,
      COMPLETED: 2,
      CANCELLED: 3,
    },
  }),
  { virtual: true },
);
import { RentalStatusEnum } from '@scspace-depot/enums/rental.enum';

describe('RentalController orchestration', () => {
  const rentalService = {
    createRentalAdmin: jest.fn(),
    getRentalList: jest.fn(),
    getRentalById: jest.fn(),
    getUserRentals: jest.fn(),
    confirmReturn: jest.fn(),
    updateRentalAdmin: jest.fn(),
    cancelRental: jest.fn(),
    markOverdueContacted: jest.fn(),
    createGoods: jest.fn(),
    getGoodsList: jest.fn(),
    getGoodsById: jest.fn(),
    updateGoods: jest.fn(),
    deleteGoods: jest.fn(),
  };

  function controller(): RentalController {
    return new RentalController(rentalService as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes rental worker id to admin create request', async () => {
    rentalService.createRentalAdmin.mockResolvedValue({
      success: true,
      data: { id: 10 },
    });
    const req = { user: { id: 99 } } as never;

    await expect(
      controller().createRentalAdmin({} as never, req),
    ).resolves.toEqual({ success: true, data: { id: 10 } });

    expect(rentalService.createRentalAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ rentalWorkerId: 99 }),
    );
  });

  it('uses default pagination values for rental list', async () => {
    rentalService.getRentalList.mockResolvedValue({ data: [], count: 0 });

    await expect(
      controller().getRentalList(undefined as never, undefined as never),
    ).resolves.toEqual({
      data: [],
      count: 0,
    });
    expect(rentalService.getRentalList).toHaveBeenCalledWith(50, 0);
  });

  it('parses list filters for user rental and normalizes isActive string', async () => {
    const userRentals = { data: [], count: 0 };
    rentalService.getUserRentals.mockResolvedValue(userRentals);

    await expect(
      controller().getUserRentals(8, 'true', 10 as never, 20 as never),
    ).resolves.toEqual(userRentals);
    expect(rentalService.getUserRentals).toHaveBeenCalledWith({
      userId: 8,
      isActive: true,
      limit: 10,
      offset: 20,
    });
  });

  it('gets goods availability from the public service layer', async () => {
    const rentalPublicService = {
      checkGoodsAvailability: jest.fn().mockResolvedValue(true),
    };
    const rentalController = new RentalController({
      ...rentalService,
      rentalPublicService,
    } as never);

    await expect(
      rentalController.checkGoodsAvailability({
        goodsId: 2,
        count: 3,
        timeBorrow: 10,
        timeDue: 20,
      }),
    ).resolves.toEqual({ available: true });
    expect(rentalPublicService.checkGoodsAvailability).toHaveBeenCalledWith({
      goodsId: 2,
      organizationId: 3,
      count: 3,
      timeBorrow: 10,
      timeDue: 20,
    });
  });

  it('forwards my-rental list request with user identity', async () => {
    const req = { user: { id: 77 } } as never;
    rentalService.getUserRentals.mockResolvedValue({ data: [], count: 0 });

    await expect(
      controller().getMyRentals(req, 'false', 5 as never, 6 as never),
    ).resolves.toEqual({ data: [], count: 0 });
    expect(rentalService.getUserRentals).toHaveBeenCalledWith({
      userId: 77,
      isActive: false,
      limit: 5,
      offset: 6,
    });
  });

  it('passes jwt user to private rental detail read', async () => {
    const rental = {
      id: 5,
      userId: 7,
      status: RentalStatusEnum.ACTIVE,
      goodsId: 2,
      timeBorrow: 1,
      timeDue: 2,
      count: 1,
      certName: 'p',
      phoneNumber: '010-0000-0000',
      emergencyContactPresident: '010-1111-1111',
      emergencyContactVicePresident: '010-2222-2222',
      reasonLocation: 'N1',
      reasonPurpose: 'Event',
      rentalWorkerId: 1,
      returnWorkerId: null,
      timeReturn: 0,
      overdueContactedById: null,
    };
    rentalService.getRentalById.mockResolvedValue(rental);
    const req = { user: { id: 7 } } as { user: { id: number } };

    await expect(controller().getRentalById(5, req as never)).resolves.toEqual(
      rental,
    );
    expect(rentalService.getRentalById).toHaveBeenCalledWith(5, req.user);
  });

  it('passes file path as image URI when creating goods', async () => {
    rentalService.createGoods.mockResolvedValue({
      success: true,
      data: { id: 1 },
    });
    const file = { filename: 'item.png' } as Express.Multer.File;

    await expect(
      controller().createGoods(file, { name: 'pad', countAll: '3' } as never),
    ).resolves.toEqual({
      success: true,
      data: { id: 1 },
    });
    expect(rentalService.createGoods).toHaveBeenCalledWith(
      expect.objectContaining({
        countAll: 3,
        imageURI: '/uploads/item.png',
      }),
    );
  });

  it('forwards zero/false confirmation path and propagates bad request', async () => {
    rentalService.confirmReturn.mockRejectedValue(
      new BadRequestException('Only managers can confirm returns'),
    );

    await expect(
      controller().confirmReturn(1, { user: { id: 2, type: 1 } } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates goods with optional file and parsed countAll', async () => {
    rentalService.updateGoods.mockResolvedValue({ success: true });
    const file = { filename: 'update.png' } as Express.Multer.File;

    await expect(
      controller().updateGoods(7, file, {
        name: 'board',
        countAll: '10',
        countNow: 2,
      } as never),
    ).resolves.toEqual({ success: true });
    expect(rentalService.updateGoods).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        name: 'board',
        imageURI: '/uploads/update.png',
        countAll: 10,
        countNow: 2,
      }),
    );
  });

  it('deletes goods through service with id', async () => {
    rentalService.deleteGoods.mockResolvedValue({ success: true });

    await expect(controller().deleteGoods(12)).resolves.toEqual({
      success: true,
    });
    expect(rentalService.deleteGoods).toHaveBeenCalledWith(12);
  });
});
