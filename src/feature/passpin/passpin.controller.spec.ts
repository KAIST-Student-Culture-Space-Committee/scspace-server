jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({
    UserUtils: {
      isManager: (type: number) => type === 2,
    },
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
  '@scspace-server/feature/passpin/passpin.service',
  () => ({ PasspinService: class {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/tools/mailer/mail.service',
  () => ({ MailService: class {} }),
  { virtual: true },
);

import { PasspinController } from './passpin.controller';

describe('PasspinController', () => {
  const passpinService = {
    changePin: jest.fn(),
    deleteCurrentPin: jest.fn(),
    getActivePins: jest.fn(),
    getActivePinsByUser: jest.fn(),
    getOlderPins: jest.fn(),
  };

  function controller(): PasspinController {
    return new PasspinController(passpinService as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes next pin value to service when changing pin', async () => {
    passpinService.changePin.mockResolvedValue({ id: 10, pin: '5678' });
    await controller().changePasspin({
      spaceId: 10,
      next: '5678',
    });

    expect(passpinService.changePin).toHaveBeenCalledWith(10, '5678');
  });

  it('defaults next pin to null when omitted', async () => {
    passpinService.changePin.mockResolvedValue({ id: 10, pin: '0000' });
    await controller().changePasspin({
      spaceId: 10,
    });

    expect(passpinService.changePin).toHaveBeenCalledWith(10, null);
  });

  it('returns global pins for manager users', async () => {
    const pins = [{ pin: '1111' }];
    passpinService.getActivePins.mockResolvedValue(pins);

    await expect(
      controller().getCurrentPin({ user: { type: 2 } } as never),
    ).resolves.toEqual(pins);
    expect(passpinService.getActivePins).toHaveBeenCalledTimes(1);
    expect(passpinService.getActivePinsByUser).not.toHaveBeenCalled();
  });

  it('returns user pins for non-managers', async () => {
    const pins = [{ pin: '2222' }];
    passpinService.getActivePinsByUser.mockResolvedValue(pins);

    await expect(
      controller().getCurrentPin({ user: { id: 9, type: 1 } } as never),
    ).resolves.toEqual(pins);
    expect(passpinService.getActivePinsByUser).toHaveBeenCalledWith(9);
    expect(passpinService.getActivePins).not.toHaveBeenCalled();
  });

  it('uses default history options when missing', async () => {
    passpinService.getOlderPins.mockResolvedValue([{ id: 1 }]);

    await controller().getHistory(3);

    expect(passpinService.getOlderPins).toHaveBeenCalledWith(3, 10, false);
  });

  it('forwards delete passpin requests to service', async () => {
    passpinService.deleteCurrentPin.mockResolvedValue(undefined);

    await expect(
      controller().deletePasspin(9 as never),
    ).resolves.toBeUndefined();
    expect(passpinService.deleteCurrentPin).toHaveBeenCalledWith(9);
  });

  it('does not pass optional next field when null string is explicitly given', async () => {
    passpinService.changePin.mockResolvedValue({ id: 10, pin: '1234' });

    await controller().changePasspin({
      spaceId: 10,
      next: '',
    } as never);

    expect(passpinService.changePin).toHaveBeenCalledWith(10, '');
  });
});
