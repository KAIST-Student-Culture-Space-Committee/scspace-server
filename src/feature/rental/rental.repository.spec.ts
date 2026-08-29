jest.mock('src/db/db.provider', () => ({ DBAsyncProvider: Symbol('DB') }), {
  virtual: true,
});
jest.mock(
  '@schema',
  () => ({
    schema: {},
    Rental: {
      id: 'rental.id',
      status: 'rental.status',
      goodsId: 'rental.goodsId',
      count: 'rental.count',
      userId: 'rental.userId',
      timeDue: 'rental.timeDue',
      timeReturn: 'rental.timeReturn',
    },
    Goods: {
      id: 'goods.id',
      countAll: 'goods.countAll',
      countNow: 'goods.countNow',
    },
    User: { id: 'user.id', timeOverdue: 'user.timeOverdue' },
  }),
  { virtual: true },
);
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => ({})),
  and: jest.fn(() => ({})),
  gt: jest.fn(() => ({})),
  lt: jest.fn(() => ({})),
  desc: jest.fn(() => ({})),
  or: jest.fn(() => ({})),
  gte: jest.fn(() => ({})),
  lte: jest.fn(() => ({})),
  count: jest.fn(() => ({})),
  ne: jest.fn(() => ({})),
  asc: jest.fn(() => ({})),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));
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
jest.mock(
  '@scspace-server/common/utils',
  () => {
    const encode = (date: Date) => Math.floor(date.getTime() / 60_000);
    return {
      getNow: jest.fn(() => 1),
      addLegacyTimeDays: jest.fn((value: number, days: number) => {
        const date = new Date(value * 60_000);
        date.setDate(date.getDate() + days);
        return encode(date);
      }),
      getLegacyTimeAtEndOfDay: jest.fn((value: number) => {
        const date = new Date(value * 60_000);
        date.setHours(23, 59, 59, 999);
        return encode(date);
      }),
    };
  },
  { virtual: true },
);
jest.mock(
  '@scspace-depot/consts/rental.const',
  () => ({ MAX_RENTAL_LIMIT: 3 }),
  { virtual: true },
);

import { RentalStatusEnum } from '@scspace-depot/enums/rental.enum';
import { RentalRepository } from './rental.repository';

describe('RentalRepository.confirmReturnWithStock', () => {
  function database(results: number[]) {
    const updates: { table: unknown; values: Record<string, unknown> }[] = [];
    const tx = {
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({
            for: async () => [{ timeOverdue: 0 }],
          }),
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table, values });
            return [{ affectedRows: results.shift() ?? 0 }];
          },
        }),
      })),
    };
    const db = {
      transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    return { db, tx, updates };
  }

  const params = {
    id: 5,
    goodsId: 8,
    count: 2,
    userId: 7,
    timeDue: 1_000,
    expectedTimeReturn: 0,
    timeReturn: 9_000,
    returnWorkerId: 99,
    overdueDays: 3,
  };

  it('updates rental state, stock, and penalty in one transaction', async () => {
    const { db, tx, updates } = database([1, 1, 1]);
    const repository = new RentalRepository(db as never);

    await expect(repository.confirmReturnWithStock(params)).resolves.toBe(true);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(3);
    expect(updates[0].values).toEqual({
      timeReturn: 9_000,
      returnWorkerId: 99,
      status: RentalStatusEnum.COMPLETED,
    });
    expect(updates[1].values).toHaveProperty('countNow');
    const expectedPenaltyDate = new Date(9_000 * 60_000);
    expectedPenaltyDate.setDate(expectedPenaltyDate.getDate() + 3);
    expectedPenaltyDate.setHours(23, 59, 59, 999);
    expect(updates[2].values).toEqual({
      timeOverdue: Math.floor(expectedPenaltyDate.getTime() / 60_000),
    });
  });

  it('returns false and does not restore stock when the state predicate loses a race', async () => {
    const { db, tx } = database([0]);
    const repository = new RentalRepository(db as never);

    await expect(repository.confirmReturnWithStock(params)).resolves.toBe(
      false,
    );
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('cancels an active rental and restores stock in one transaction', async () => {
    const { db, tx, updates } = database([1, 1]);
    const repository = new RentalRepository(db as never);

    await expect(
      repository.cancelRentalWithStock({
        id: 5,
        goodsId: 8,
        count: 2,
      }),
    ).resolves.toBe(true);

    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(updates[0].values).toEqual({ status: RentalStatusEnum.CANCELLED });
    expect(updates[1].values).toHaveProperty('countNow');
  });
});

describe('RentalRepository.updateGoodsInventory', () => {
  it('preserves the borrowed quantity while changing total stock', async () => {
    let updatedValues: Record<string, unknown> = {};
    const tx = {
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({
            for: async () => [{ countAll: 10, countNow: 6 }],
          }),
        }),
      })),
      update: jest.fn(() => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updatedValues = values;
            return [{ affectedRows: 1 }];
          },
        }),
      })),
    };
    const db = {
      transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const repository = new RentalRepository(db as never);

    await expect(repository.updateGoodsInventory(8, 8, {})).resolves.toBe(true);

    expect(updatedValues).toEqual({ countAll: 8, countNow: 4 });
  });
});
