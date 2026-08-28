jest.mock('src/db/db.provider', () => ({ DBAsyncProvider: Symbol('DB') }), {
  virtual: true,
});
jest.mock(
  '@schema',
  () => ({
    schema: {},
    Passpin: {
      id: 'passpin.id',
      spaceId: 'passpin.spaceId',
      status: 'passpin.status',
    },
    Space: { id: 'space.id' },
    Reservation: {
      spaceId: 'reservation.spaceId',
      organizationId: 'reservation.organizationId',
      userId: 'reservation.userId',
      state: 'reservation.state',
      timeFrom: 'reservation.timeFrom',
      timeTo: 'reservation.timeTo',
    },
    OrganizationMember: {
      organizationId: 'organizationMember.organizationId',
      userId: 'organizationMember.userId',
    },
  }),
  { virtual: true },
);
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...conditions: unknown[]) => ({ operator: 'and', conditions })),
  count: jest.fn(() => ({ operator: 'count' })),
  desc: jest.fn((value: unknown) => ({ operator: 'desc', value })),
  eq: jest.fn((left: unknown, right: unknown) => ({
    operator: 'eq',
    left,
    right,
  })),
  gt: jest.fn((left: unknown, right: unknown) => ({
    operator: 'gt',
    left,
    right,
  })),
  lte: jest.fn((left: unknown, right: unknown) => ({
    operator: 'lte',
    left,
    right,
  })),
  ne: jest.fn((left: unknown, right: unknown) => ({
    operator: 'ne',
    left,
    right,
  })),
  or: jest.fn((...conditions: unknown[]) => ({ operator: 'or', conditions })),
}));
jest.mock(
  '@scspace-depot/enums/passpin.enum',
  () => ({ PasspinEnum: { USING: 0, OUTDATED: -1 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/reservation.enum',
  () => ({ ReservationStateEnum: { GRANT: 1 } }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/consts/organization.const',
  () => ({ IndividualOrganizationId: 1 }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/common/utils',
  () => ({ getNow: jest.fn(() => 1_000) }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/passpin/passpin.model',
  () => ({
    MPasspin: { fromDB: jest.fn() },
    MPasspinSpace: { fromDB: jest.fn() },
  }),
  { virtual: true },
);
jest.mock('../space/space.model', () => ({
  MSpace: { fromDB: jest.fn() },
}));
jest.mock('./passpin.utils', () => ({
  PasspinUtils: class {},
}));

import { eq, gt, lte, ne } from 'drizzle-orm';
import { PasspinRepository } from './passpin.repository';

describe('PasspinRepository.fetchActivePinsByUserId', () => {
  function database() {
    const chain: Record<string, jest.Mock> & {
      then?: (resolve: (rows: unknown[]) => unknown) => Promise<unknown>;
    } = {};

    for (const method of ['from', 'innerJoin', 'leftJoin', 'where']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.then = (resolve) => Promise.resolve(resolve([]));

    return {
      db: {
        selectDistinct: jest.fn(() => chain),
      },
      chain,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('limits PIN exposure to GRANT reservations', async () => {
    const { db } = database();
    const repository = new PasspinRepository(db as never, {} as never);

    await repository.fetchActivePinsByUserId(7);

    expect(eq).toHaveBeenCalledWith('reservation.state', 1);
    expect(eq).toHaveBeenCalledWith('passpin.status', 0);
  });

  it('covers the full [timeFrom - 60, timeTo + 60) window', async () => {
    const { db } = database();
    const repository = new PasspinRepository(db as never, {} as never);

    await repository.fetchActivePinsByUserId(7);

    expect(lte).toHaveBeenCalledWith('reservation.timeFrom', 1_060);
    expect(gt).toHaveBeenCalledWith('reservation.timeTo', 940);
  });

  it('allows the individual owner or a current organization member', async () => {
    const { db } = database();
    const repository = new PasspinRepository(db as never, {} as never);

    await repository.fetchActivePinsByUserId(7);

    expect(eq).toHaveBeenCalledWith('reservation.organizationId', 1);
    expect(eq).toHaveBeenCalledWith('reservation.userId', 7);
    expect(ne).toHaveBeenCalledWith('reservation.organizationId', 1);
    expect(eq).toHaveBeenCalledWith('organizationMember.userId', 7);
  });
});
