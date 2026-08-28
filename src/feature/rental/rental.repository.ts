import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DBAsyncProvider } from 'src/db/db.provider';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { schema, Rental, Goods, User } from '@schema';
import {
  eq,
  and,
  SQL,
  gt,
  lt,
  desc,
  or,
  gte,
  count,
  asc,
  sql,
  ne,
} from 'drizzle-orm';
import {
  IRentalCreate,
  IRentalUpdateAdmin,
  IGoodsCreate,
  IGoodsUpdate,
  IGoodsAvailabilityCheck,
} from '@scspace-depot/types/rental';
import { RentalStatusEnum } from '@scspace-depot/enums/rental.enum';
import {
  addLegacyTimeDays,
  getLegacyTimeAtEndOfDay,
  getNow,
} from '@scspace-server/common/utils';
import { IDataResponse } from '@scspace-depot/types/common/common.type';
import {
  MAX_RENTAL_LIMIT,
  RENTAL_CERTIFICATE_PENDING,
} from '@scspace-depot/consts/rental.const';

@Injectable()
export class RentalRepository {
  constructor(
    @Inject(DBAsyncProvider) private readonly db: MySql2Database<typeof schema>,
  ) {}

  async createRentalWithAtomicStock(
    rental: IRentalCreate &
      Partial<{
        groupName: string | null;
        contact: string | null;
        emergencyContact: string | null;
        usingLocation: string | null;
        usingPurpose: string | null;
        approverId: number | null;
        returnApproverId: number | null;
        status: RentalStatusEnum;
      }>,
  ): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      await this.assertUserCanRent(tx, rental.userId);

      const stockUpdateResult = await tx
        .update(Goods)
        .set({
          countNow: sql`${Goods.countNow} - ${rental.count}`,
        })
        .where(
          and(eq(Goods.id, rental.goodsId), gte(Goods.countNow, rental.count)),
        );

      if (stockUpdateResult[0].affectedRows === 0) {
        return null;
      }

      const insertResult = await tx.insert(Rental).values({
        ...rental,
        timeReturn: 0,
        timeConfirm: 0,
        certName: RENTAL_CERTIFICATE_PENDING,
      });

      return insertResult[0].insertId;
    });
  }

  async fetchRentalById(
    id: number,
  ): Promise<typeof Rental.$inferSelect | null> {
    const result = await this.db.select().from(Rental).where(eq(Rental.id, id));
    return result[0] || null;
  }

  async fetchRentalsByUserId(
    userId: number,
    isActive?: boolean,
    limit: number = 50,
    offset: number = 0,
  ): Promise<IDataResponse<(typeof Rental.$inferSelect)[]>> {
    const whereClause: SQL[] = [eq(Rental.userId, userId)];

    if (isActive !== undefined) {
      if (isActive) {
        whereClause.push(
          or(
            eq(Rental.status, RentalStatusEnum.ACTIVE),
            eq(Rental.status, RentalStatusEnum.RETURNED),
          ),
        );
      } else {
        whereClause.push(
          or(
            eq(Rental.status, RentalStatusEnum.COMPLETED),
            eq(Rental.status, RentalStatusEnum.CANCELLED),
          ),
        );
      }
    }

    const [data, [countResult]] = await Promise.all([
      this.db
        .select()
        .from(Rental)
        .where(and(...whereClause))
        .orderBy(desc(Rental.timeBorrow))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(Rental)
        .where(and(...whereClause)),
    ]);

    return {
      data,
      count: countResult.count,
    };
  }

  async fetchAllRentals(
    limit: number = 50,
    offset: number = 0,
  ): Promise<IDataResponse<(typeof Rental.$inferSelect)[]>> {
    const [data, [countResult]] = await Promise.all([
      this.db
        .select()
        .from(Rental)
        .orderBy(desc(Rental.timeBorrow))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(Rental),
    ]);

    return {
      data,
      count: countResult.count,
    };
  }

  //rental Cert URI update
  async updateRentalCert(id: number, filename: string): Promise<boolean> {
    const [result] = await this.db
      .update(Rental)
      .set({ certName: filename })
      .where(
        and(
          eq(Rental.id, id),
          eq(Rental.status, RentalStatusEnum.ACTIVE),
          eq(Rental.certName, RENTAL_CERTIFICATE_PENDING),
        ),
      );
    return result.affectedRows > 0;
  }

  async confirmReturnWithStock(params: {
    id: number;
    goodsId: number;
    count: number;
    userId: number;
    timeDue: number;
    expectedTimeReturn: number;
    timeReturn: number;
    timeConfirm: number;
    returnApproverId: number;
    overdueDays?: number;
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      let currentTimeOverdue: number | undefined;
      if (params.overdueDays !== undefined) {
        const [user] = await tx
          .select({ timeOverdue: User.timeOverdue })
          .from(User)
          .where(eq(User.id, params.userId))
          .for('update');
        if (!user) {
          throw new NotFoundException('User not found');
        }
        currentTimeOverdue = user.timeOverdue;
      }

      const [rentalResult] = await tx
        .update(Rental)
        .set({
          timeReturn: params.timeReturn,
          timeConfirm: params.timeConfirm,
          returnApproverId: params.returnApproverId,
          status: RentalStatusEnum.COMPLETED,
        })
        .where(
          and(
            eq(Rental.id, params.id),
            or(
              eq(Rental.status, RentalStatusEnum.ACTIVE),
              eq(Rental.status, RentalStatusEnum.RETURNED),
            ),
            eq(Rental.userId, params.userId),
            eq(Rental.goodsId, params.goodsId),
            eq(Rental.count, params.count),
            eq(Rental.timeDue, params.timeDue),
            eq(Rental.timeReturn, params.expectedTimeReturn),
            eq(Rental.timeConfirm, 0),
          ),
        );

      if (rentalResult.affectedRows === 0) {
        return false;
      }

      const [goodsResult] = await tx
        .update(Goods)
        .set({ countNow: sql`${Goods.countNow} + ${params.count}` })
        .where(eq(Goods.id, params.goodsId));

      if (goodsResult.affectedRows === 0) {
        throw new NotFoundException('Goods not found');
      }

      if (
        params.overdueDays !== undefined &&
        currentTimeOverdue !== undefined
      ) {
        const penaltyBase = Math.max(currentTimeOverdue, params.timeReturn);
        const overdueEndTime = getLegacyTimeAtEndOfDay(
          addLegacyTimeDays(penaltyBase, params.overdueDays),
        );
        const [userResult] = await tx
          .update(User)
          .set({ timeOverdue: overdueEndTime })
          .where(eq(User.id, params.userId));

        if (userResult.affectedRows === 0) {
          throw new NotFoundException('User not found');
        }
      }

      return true;
    });
  }

  async updateActiveRentalWithStock(
    current: typeof Rental.$inferSelect,
    updates: IRentalUpdateAdmin,
  ): Promise<boolean> {
    const nextGoodsId = updates.goodsId ?? current.goodsId;
    const nextCount = updates.count ?? current.count;

    return await this.db.transaction(async (tx) => {
      const nextUserId = updates.userId ?? current.userId;
      if (nextUserId === current.userId) {
        await this.lockRentalUser(tx, nextUserId);
      } else {
        await this.assertUserCanRent(tx, nextUserId, current.id);
      }

      const [rentalResult] = await tx
        .update(Rental)
        .set({ ...updates, certName: RENTAL_CERTIFICATE_PENDING })
        .where(
          and(
            eq(Rental.id, current.id),
            eq(Rental.status, RentalStatusEnum.ACTIVE),
            eq(Rental.goodsId, current.goodsId),
            eq(Rental.count, current.count),
          ),
        );

      if (rentalResult.affectedRows === 0) {
        return false;
      }

      if (nextGoodsId === current.goodsId) {
        const additionalCount = nextCount - current.count;
        if (additionalCount > 0) {
          const [stockResult] = await tx
            .update(Goods)
            .set({ countNow: sql`${Goods.countNow} - ${additionalCount}` })
            .where(
              and(
                eq(Goods.id, current.goodsId),
                gte(Goods.countNow, additionalCount),
              ),
            );
          if (stockResult.affectedRows === 0) {
            throw new BadRequestException('Insufficient stock');
          }
        } else if (additionalCount < 0) {
          await tx
            .update(Goods)
            .set({ countNow: sql`${Goods.countNow} + ${-additionalCount}` })
            .where(eq(Goods.id, current.goodsId));
        }
        return true;
      }

      const [newStockResult] = await tx
        .update(Goods)
        .set({ countNow: sql`${Goods.countNow} - ${nextCount}` })
        .where(and(eq(Goods.id, nextGoodsId), gte(Goods.countNow, nextCount)));
      if (newStockResult.affectedRows === 0) {
        throw new BadRequestException('Insufficient stock');
      }

      const [oldStockResult] = await tx
        .update(Goods)
        .set({ countNow: sql`${Goods.countNow} + ${current.count}` })
        .where(eq(Goods.id, current.goodsId));
      if (oldStockResult.affectedRows === 0) {
        throw new NotFoundException('Original goods not found');
      }

      return true;
    });
  }

  async cancelRentalWithStock(params: {
    id: number;
    goodsId: number;
    count: number;
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [rentalResult] = await tx
        .update(Rental)
        .set({ status: RentalStatusEnum.CANCELLED })
        .where(
          and(
            eq(Rental.id, params.id),
            eq(Rental.status, RentalStatusEnum.ACTIVE),
            eq(Rental.goodsId, params.goodsId),
            eq(Rental.count, params.count),
          ),
        );
      if (rentalResult.affectedRows === 0) {
        return false;
      }

      const [goodsResult] = await tx
        .update(Goods)
        .set({ countNow: sql`${Goods.countNow} + ${params.count}` })
        .where(eq(Goods.id, params.goodsId));
      if (goodsResult.affectedRows === 0) {
        throw new NotFoundException('Goods not found');
      }
      return true;
    });
  }

  async markOverdueContacted(params: {
    id: number;
    contactedAt: number;
    contactedById: number;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(Rental)
      .set({
        overdueContactedAt: params.contactedAt,
        overdueContactedById: params.contactedById,
      })
      .where(
        and(
          eq(Rental.id, params.id),
          eq(Rental.status, RentalStatusEnum.ACTIVE),
          lt(Rental.timeDue, params.contactedAt),
          eq(Rental.overdueContactedAt, 0),
        ),
      );
    return result.affectedRows > 0;
  }

  // Goods CRUD operations
  async createGoods(goods: IGoodsCreate): Promise<number> {
    const result = await this.db.insert(Goods).values({
      ...goods,
      countNow: goods.countAll, // countNow를 countAll과 같은 값으로 설정
    });
    return result[0].insertId;
  }

  async fetchGoodsById(id: number): Promise<typeof Goods.$inferSelect | null> {
    const result = await this.db.select().from(Goods).where(eq(Goods.id, id));
    return result[0] || null;
  }

  async fetchAllGoods(): Promise<(typeof Goods.$inferSelect)[]> {
    return await this.db.select().from(Goods).orderBy(asc(Goods.name));
  }

  async updateGoods(id: number, updates: IGoodsUpdate): Promise<void> {
    await this.db.update(Goods).set(updates).where(eq(Goods.id, id));
  }

  async updateGoodsInventory(
    id: number,
    countAll: number,
    updates: Omit<IGoodsUpdate, 'countAll' | 'countNow'>,
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [goods] = await tx
        .select({
          countAll: Goods.countAll,
          countNow: Goods.countNow,
        })
        .from(Goods)
        .where(eq(Goods.id, id))
        .for('update');
      if (!goods) {
        return false;
      }

      const borrowedCount = goods.countAll - goods.countNow;
      const countNow = countAll - borrowedCount;
      if (countNow < 0) {
        return false;
      }

      const [result] = await tx
        .update(Goods)
        .set({ ...updates, countAll, countNow })
        .where(eq(Goods.id, id));
      return result.affectedRows > 0;
    });
  }

  async deleteGoodsIfUnused(id: number): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [goods] = await tx
        .select({ id: Goods.id })
        .from(Goods)
        .where(eq(Goods.id, id))
        .for('update');
      if (!goods) {
        return false;
      }

      const [rentals] = await tx
        .select({ totalCount: count() })
        .from(Rental)
        .where(eq(Rental.goodsId, id));
      if (Number(rentals?.totalCount ?? 0) > 0) {
        return false;
      }

      const [result] = await tx.delete(Goods).where(eq(Goods.id, id));
      return result.affectedRows > 0;
    });
  }

  // Availability check
  async checkGoodsAvailability(
    check: IGoodsAvailabilityCheck,
  ): Promise<boolean> {
    const { goodsId, count: requestedCount } = check;

    // 해당 물품 정보 조회
    const goods = await this.fetchGoodsById(goodsId);
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }

    // 현재 사용 가능한 수량 확인
    if (goods.countNow < requestedCount) {
      return false;
    }

    return true;
  }

  // 각 상황별로 분리된 검사 함수들
  async checkRentalLimit(userId: number): Promise<boolean> {
    const countRental = await this.db
      .select({ totalCount: count() })
      .from(Rental)
      .where(
        and(
          eq(Rental.userId, userId),
          or(
            eq(Rental.status, RentalStatusEnum.ACTIVE),
            eq(Rental.status, RentalStatusEnum.RETURNED),
          ),
        ),
      )
      .then((res) => res[0]?.totalCount || 0);

    return countRental < MAX_RENTAL_LIMIT;
  }

  async checkCurrentOverdue(userId: number): Promise<boolean> {
    const now = getNow();
    const overdueCount = await this.db
      .select({ totalCount: count() })
      .from(Rental)
      .where(
        and(
          eq(Rental.userId, userId),
          eq(Rental.status, RentalStatusEnum.ACTIVE),
          lt(Rental.timeDue, now), // 기한이 지남
        ),
      )
      .then((res) => res[0]?.totalCount || 0);

    return overdueCount === 0;
  }

  async checkUnconfirmedOverdueReturns(userId: number): Promise<boolean> {
    const unconfirmedOverdueCount = await this.db
      .select({ totalCount: count() })
      .from(Rental)
      .where(
        and(
          eq(Rental.userId, userId),
          gt(Rental.timeReturn, 0), // 반납은 했음
          eq(Rental.timeConfirm, 0), // 아직 관리자 확인 안됨
          lt(Rental.timeDue, Rental.timeReturn), // 연체된 반납 (due < return)
        ),
      )
      .then((res) => res[0]?.totalCount || 0);

    return unconfirmedOverdueCount === 0;
  }

  async checkUserOverduePenalty(userId: number): Promise<boolean> {
    const now = getNow();

    // User 테이블에서 timeOverdue 확인
    const userResult = await this.db
      .select({ timeOverdue: User.timeOverdue })
      .from(User)
      .where(eq(User.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return false; // 사용자를 찾을 수 없음
    }

    const user = userResult[0];

    // timeOverdue가 0이거나 현재 시간이 timeOverdue를 지났으면 대여 가능
    return user.timeOverdue === 0 || now > user.timeOverdue;
  }

  private async assertUserCanRent(
    executor: Pick<MySql2Database<typeof schema>, 'select'>,
    userId: number,
    excludedRentalId?: number,
  ): Promise<void> {
    const now = getNow();
    const user = await this.lockRentalUser(executor, userId);
    if (user.timeOverdue > now) {
      throw new BadRequestException('User is currently under a rental penalty');
    }

    const conditions = [
      eq(Rental.userId, userId),
      or(
        eq(Rental.status, RentalStatusEnum.ACTIVE),
        eq(Rental.status, RentalStatusEnum.RETURNED),
      ),
    ];
    if (excludedRentalId !== undefined) {
      conditions.push(ne(Rental.id, excludedRentalId));
    }

    const activeRentals = await executor
      .select({
        status: Rental.status,
        timeDue: Rental.timeDue,
        timeReturn: Rental.timeReturn,
        timeConfirm: Rental.timeConfirm,
      })
      .from(Rental)
      .where(and(...conditions));

    if (activeRentals.length >= MAX_RENTAL_LIMIT) {
      throw new BadRequestException(
        `User has reached the maximum rental limit: ${MAX_RENTAL_LIMIT}`,
      );
    }
    if (
      activeRentals.some(
        (rental) =>
          rental.status === RentalStatusEnum.ACTIVE && rental.timeDue < now,
      )
    ) {
      throw new BadRequestException('User has an overdue rental');
    }
    if (
      activeRentals.some(
        (rental) =>
          rental.status === RentalStatusEnum.RETURNED &&
          rental.timeReturn > rental.timeDue &&
          rental.timeConfirm === 0,
      )
    ) {
      throw new BadRequestException('User has an unconfirmed overdue return');
    }
  }

  private async lockRentalUser(
    executor: Pick<MySql2Database<typeof schema>, 'select'>,
    userId: number,
  ): Promise<{ timeOverdue: number }> {
    const [user] = await executor
      .select({ timeOverdue: User.timeOverdue })
      .from(User)
      .where(eq(User.id, userId))
      .for('update');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // Get overdue rentals
  async getOverdueRentals(): Promise<(typeof Rental.$inferSelect)[]> {
    const now = getNow();
    return await this.db
      .select()
      .from(Rental)
      .where(
        and(
          eq(Rental.status, RentalStatusEnum.ACTIVE),
          lt(Rental.timeDue, now),
        ),
      );
  }
}
