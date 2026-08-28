jest.mock(
  '@scspace-server/common/utils',
  () => ({
    checkContainAllId: jest.fn(),
    takeAll: jest.fn(() => (value: unknown) => value),
    getNow: jest.fn(() => 10_000),
    getDate: jest.fn((value: number) => new Date(value * 60_000)),
    getTime: jest.fn((date: Date) => Math.floor(date.getTime() / 60_000)),
    getDateEnd: jest.fn((value: number) => value),
    getDateDiffInMinute: jest.fn((from: number, to: number) => to - from),
    getDateString: jest.fn(String),
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/consts/rental.const',
  () => ({
    MAX_RENTAL_LIMIT: 3,
    RENTAL_DUTY_HOURS: [{ dayOfWeek: 1, startMinute: 1_140, endMinute: 1_260 }],
  }),
  { virtual: true },
);
jest.mock('@js-temporal/polyfill', () => ({
  Temporal: {
    Now: {
      zonedDateTimeISO: jest.fn(() => ({
        dayOfWeek: 1,
        hour: 19,
        minute: 30,
      })),
    },
  },
}));
jest.mock(
  '@scspace-depot/consts/file.const',
  () => ({ PRIVATE_FOLDER: './uploads/private' }),
  { virtual: true },
);
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
jest.mock('@scspace-depot/enums/mail.enum', () => ({ RentalMeta: {} }), {
  virtual: true,
});
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({ UserUtils: { isManager: (type: number) => type === 2 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/file/file.service',
  () => ({ FileService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/pdf/pdf.service',
  () => ({ PdfService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/mailer/mail.service',
  () => ({ MailService: class {} }),
  { virtual: true },
);
jest.mock('./rental.repository', () => ({ RentalRepository: class {} }));
jest.mock('./rental.public.service', () => ({ RentalPublicService: class {} }));
jest.mock('../user/user.public.service', () => ({
  UserPublicService: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import { getDateDiffInMinute } from '@scspace-server/common/utils';
import { RentalStatusEnum } from '@scspace-depot/enums/rental.enum';
import { RentalService } from './rental.service';

describe('RentalService.confirmReturn', () => {
  const rentalRepository = {
    confirmReturnWithStock: jest.fn(),
  };
  const rentalPublicService = {
    getRentalById: jest.fn(),
  };
  const userPublicService = {
    fetchById: jest.fn(),
  };
  const fileService = {
    deletePrivateFile: jest.fn(),
  };
  const actor = { id: 99, type: 2 };

  function service(): RentalService {
    return new RentalService(
      rentalRepository as never,
      rentalPublicService as never,
      userPublicService as never,
      fileService as never,
      {} as never,
      {} as never,
    );
  }

  function rental(overrides: Record<string, unknown> = {}) {
    return {
      id: 5,
      userId: 7,
      goodsId: 8,
      count: 2,
      timeBorrow: 100,
      timeDue: 1_000,
      timeReturn: 3_881,
      timeConfirm: 0,
      certName: 'rental.pdf',
      status: RentalStatusEnum.RETURNED,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (Temporal.Now.zonedDateTimeISO as jest.Mock).mockReturnValue({
      dayOfWeek: 1,
      hour: 19,
      minute: 30,
    });
    rentalRepository.confirmReturnWithStock.mockResolvedValue(true);
    fileService.deletePrivateFile.mockResolvedValue(undefined);
  });

  it('calculates positive overdue days for the atomic repository call', async () => {
    const returnedAt = 3_881;
    rentalPublicService.getRentalById.mockResolvedValue(
      rental({ timeReturn: returnedAt }),
    );
    await expect(service().confirmReturn(5, actor as never)).resolves.toEqual({
      success: true,
    });

    expect(getDateDiffInMinute).toHaveBeenCalledWith(1_000, returnedAt);
    expect(rentalRepository.confirmReturnWithStock).toHaveBeenCalledWith({
      id: 5,
      goodsId: 8,
      count: 2,
      userId: 7,
      timeDue: 1_000,
      expectedTimeReturn: returnedAt,
      timeReturn: returnedAt,
      timeConfirm: 10_000,
      returnApproverId: 99,
      overdueDays: 3,
    });
  });

  it('completes an active rental directly during duty hours', async () => {
    rentalPublicService.getRentalById.mockResolvedValue(
      rental({
        status: RentalStatusEnum.ACTIVE,
        timeDue: 12_000,
        timeReturn: 0,
      }),
    );

    await expect(service().confirmReturn(5, actor as never)).resolves.toEqual({
      success: true,
    });

    expect(rentalRepository.confirmReturnWithStock).toHaveBeenCalledWith({
      id: 5,
      goodsId: 8,
      count: 2,
      userId: 7,
      timeDue: 12_000,
      expectedTimeReturn: 0,
      timeReturn: 10_000,
      timeConfirm: 10_000,
      returnApproverId: 99,
      overdueDays: undefined,
    });
  });

  it('rejects physical return handling outside duty hours', async () => {
    (Temporal.Now.zonedDateTimeISO as jest.Mock).mockReturnValue({
      dayOfWeek: 1,
      hour: 18,
      minute: 59,
    });

    await expect(service().confirmReturn(5, actor as never)).rejects.toThrow(
      'duty hours',
    );
    expect(rentalPublicService.getRentalById).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a cancelled rental',
      value: {
        status: RentalStatusEnum.CANCELLED,
        timeReturn: 0,
        timeConfirm: 0,
      },
      message: 'This rental cannot be returned',
    },
    {
      name: 'an already confirmed return',
      value: {
        status: RentalStatusEnum.RETURNED,
        timeReturn: 2_000,
        timeConfirm: 3_000,
      },
      message: 'This return has already been confirmed',
    },
  ])('rejects $name before touching stock', async ({ value, message }) => {
    rentalPublicService.getRentalById.mockResolvedValue(rental(value));

    await expect(service().confirmReturn(5, actor as never)).rejects.toThrow(
      message,
    );
    expect(rentalRepository.confirmReturnWithStock).not.toHaveBeenCalled();
  });

  it('rejects a concurrent confirmation reported by the repository', async () => {
    rentalPublicService.getRentalById.mockResolvedValue(
      rental({ timeDue: 4_000, timeReturn: 3_000 }),
    );
    rentalRepository.confirmReturnWithStock.mockResolvedValue(false);

    await expect(
      service().confirmReturn(5, actor as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fileService.deletePrivateFile).not.toHaveBeenCalled();
  });
});

describe('RentalService.updateRentalAdmin', () => {
  it('passes only editable fields to the repository', async () => {
    const rentalRepository = {
      fetchRentalById: jest.fn().mockResolvedValue({
        id: 5,
        userId: 7,
        goodsId: 8,
        count: 2,
        timeBorrow: 100,
        timeDue: 2_000,
        certName: 'old.pdf',
        contact: '010-0000-0000',
        status: RentalStatusEnum.ACTIVE,
      }),
      updateActiveRentalWithStock: jest.fn().mockResolvedValue(true),
      updateRentalCert: jest.fn().mockResolvedValue(true),
    };
    const rentalPublicService = {
      getGoodsById: jest.fn().mockResolvedValue({ id: 8, name: 'Desk' }),
    };
    const userPublicService = {
      fetchById: jest.fn().mockResolvedValue({
        id: 7,
        type: 1,
        email: 'student@kaist.ac.kr',
      }),
    };
    const fileService = {
      deletePrivateFile: jest.fn().mockResolvedValue(undefined),
    };
    const pdfService = {
      createAndStoreRentalCert: jest
        .fn()
        .mockResolvedValue({ filename: 'new.pdf' }),
    };
    const service = new RentalService(
      rentalRepository as never,
      rentalPublicService as never,
      userPublicService as never,
      fileService as never,
      pdfService as never,
      {} as never,
    );

    await expect(
      service.updateRentalAdmin(
        5,
        {
          count: 3,
          status: RentalStatusEnum.COMPLETED,
          timeConfirm: 9_999,
          approverId: 123,
        } as never,
        { id: 99, type: 2 } as never,
      ),
    ).resolves.toEqual({ success: true });

    expect(rentalRepository.updateActiveRentalWithStock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5 }),
      { count: 3, timeDue: 2_000 },
    );
  });
});

describe('RentalService.createRentalAdmin', () => {
  const rentalRepository = {
    createRentalWithAtomicStock: jest.fn(),
    updateRentalCert: jest.fn(),
  };
  const rentalPublicService = {
    getGoodsById: jest.fn(),
    checkGoodsAvailability: jest.fn(),
  };
  const userPublicService = {
    fetchById: jest.fn(),
  };
  const fileService = {
    deletePrivateFile: jest.fn(),
  };
  const pdfService = {
    createAndStoreRentalCert: jest.fn(),
  };
  const mailService = {
    sendMail: jest.fn(),
    reportError: jest.fn(),
  };

  function service(): RentalService {
    return new RentalService(
      rentalRepository as never,
      rentalPublicService as never,
      userPublicService as never,
      fileService as never,
      pdfService as never,
      mailService as never,
    );
  }

  function rentalData(overrides: Record<string, unknown> = {}) {
    return {
      userId: 7,
      goodsId: 8,
      count: 2,
      timeDue: 20_000,
      groupName: 'Space Committee',
      contact: '010-0000-0000',
      emergencyContact: '010-1111-1111',
      usingLocation: 'N1',
      usingPurpose: 'Event',
      approverId: 99,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (Temporal.Now.zonedDateTimeISO as jest.Mock).mockReturnValue({
      dayOfWeek: 1,
      hour: 19,
      minute: 30,
    });
    userPublicService.fetchById.mockResolvedValue({
      id: 7,
      email: 'student@kaist.ac.kr',
    });
    rentalPublicService.getGoodsById.mockResolvedValue({ id: 8, name: 'Desk' });
    rentalPublicService.checkGoodsAvailability.mockResolvedValue(true);
    rentalRepository.createRentalWithAtomicStock.mockResolvedValue(42);
    pdfService.createAndStoreRentalCert.mockResolvedValue({
      filename: 'rental.pdf',
    });
    rentalRepository.updateRentalCert.mockResolvedValue(true);
    mailService.sendMail.mockResolvedValue(undefined);
    mailService.reportError.mockResolvedValue(undefined);
  });

  it('validates availability and creates an active rental atomically', async () => {
    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).resolves.toEqual({
      success: true,
      data: { id: 42 },
    });

    expect(rentalPublicService.checkGoodsAvailability).toHaveBeenCalledWith({
      goodsId: 8,
      count: 2,
      timeBorrow: 10_000,
      timeDue: 20_000,
    });
    expect(rentalRepository.createRentalWithAtomicStock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        goodsId: 8,
        count: 2,
        timeBorrow: 10_000,
        timeDue: 20_000,
        approverId: 99,
        status: RentalStatusEnum.ACTIVE,
      }),
    );
    expect(pdfService.createAndStoreRentalCert).toHaveBeenCalled();
    expect(mailService.sendMail).toHaveBeenCalled();
  });

  it.each([
    { name: 'zero count', value: { count: 0 } },
    { name: 'fractional count', value: { count: 1.5 } },
    { name: 'past due time', value: { timeDue: 10_000 } },
    { name: 'blank group', value: { groupName: '   ' } },
    { name: 'blank purpose', value: { usingPurpose: '' } },
  ])('rejects $name before reading related records', async ({ value }) => {
    await expect(
      service().createRentalAdmin(rentalData(value) as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userPublicService.fetchById).not.toHaveBeenCalled();
    expect(rentalPublicService.checkGoodsAvailability).not.toHaveBeenCalled();
  });

  it('rejects requests outside committee duty hours', async () => {
    (Temporal.Now.zonedDateTimeISO as jest.Mock).mockReturnValue({
      dayOfWeek: 1,
      hour: 21,
      minute: 0,
    });

    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).rejects.toThrow('duty hours');
    expect(userPublicService.fetchById).not.toHaveBeenCalled();
  });

  it('rejects missing related records and unavailable stock', async () => {
    userPublicService.fetchById.mockResolvedValueOnce(null);
    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).rejects.toThrow('User not found');

    userPublicService.fetchById.mockResolvedValueOnce({ id: 7 });
    rentalPublicService.getGoodsById.mockResolvedValueOnce(null);
    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).rejects.toThrow('Goods not found');

    rentalPublicService.checkGoodsAvailability.mockResolvedValueOnce(false);
    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).rejects.toThrow('not available');
    expect(rentalRepository.createRentalWithAtomicStock).not.toHaveBeenCalled();
  });

  it('turns an atomic stock race into a client error', async () => {
    rentalRepository.createRentalWithAtomicStock.mockResolvedValueOnce(null);

    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).rejects.toThrow('Insufficient stock');
    expect(pdfService.createAndStoreRentalCert).not.toHaveBeenCalled();
  });

  it('keeps the rental successful when certificate or mail side effects fail', async () => {
    pdfService.createAndStoreRentalCert.mockRejectedValueOnce(
      new Error('pdf failed'),
    );

    await expect(
      service().createRentalAdmin(rentalData() as never),
    ).resolves.toEqual({
      success: true,
      data: { id: 42 },
    });
    expect(mailService.reportError).toHaveBeenCalled();
  });
});

describe('RentalService.cancelRental and markOverdueContacted', () => {
  const rentalRepository = {
    cancelRentalWithStock: jest.fn(),
    markOverdueContacted: jest.fn(),
  };
  const rentalPublicService = {
    getRentalById: jest.fn(),
  };
  const fileService = {
    deletePrivateFile: jest.fn(),
  };
  const manager = { id: 99, type: 2 };
  const student = { id: 7, type: 1 };

  function service(): RentalService {
    return new RentalService(
      rentalRepository as never,
      rentalPublicService as never,
      {} as never,
      fileService as never,
      {} as never,
      {} as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    rentalPublicService.getRentalById.mockResolvedValue({
      id: 5,
      goodsId: 8,
      count: 2,
      certName: 'rental.pdf',
    });
    rentalRepository.cancelRentalWithStock.mockResolvedValue(true);
    rentalRepository.markOverdueContacted.mockResolvedValue(true);
  });

  it('requires a manager and atomically restores stock on cancellation', async () => {
    await expect(service().cancelRental(5, student as never)).rejects.toThrow(
      'Only managers',
    );
    await expect(service().cancelRental(5, manager as never)).resolves.toEqual({
      success: true,
    });
    expect(rentalRepository.cancelRentalWithStock).toHaveBeenCalledWith({
      id: 5,
      goodsId: 8,
      count: 2,
    });
  });

  it('rejects cancellation when the rental is missing or no longer active', async () => {
    rentalPublicService.getRentalById.mockResolvedValueOnce(null);
    await expect(service().cancelRental(5, manager as never)).rejects.toThrow(
      'Rental not found',
    );

    rentalRepository.cancelRentalWithStock.mockResolvedValueOnce(false);
    await expect(service().cancelRental(5, manager as never)).rejects.toThrow(
      'Only active rentals',
    );
  });

  it('records overdue contact only through the manager path', async () => {
    await expect(
      service().markOverdueContacted(5, student as never),
    ).rejects.toThrow('Only managers');
    await expect(
      service().markOverdueContacted(5, manager as never),
    ).resolves.toEqual({ success: true });
    expect(rentalRepository.markOverdueContacted).toHaveBeenCalledWith({
      id: 5,
      contactedAt: 10_000,
      contactedById: 99,
    });
  });
});
