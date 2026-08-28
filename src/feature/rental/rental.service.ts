import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IRentalAll,
  IGoodsCreate,
  IGoodsUpdate,
  IGoods,
  IGoodsAvailabilityCheck,
  IUserRentalStatus,
  IRentalCreateAdmin,
  IRentalUpdateAdmin,
} from '@scspace-depot/types/rental';
import { IDataResponse, ISuccessResponse } from '@scspace-depot/types/common';
import {
  checkContainAllId,
  takeAll,
  getNow,
  getDateDiffInMinute,
  getDateString,
} from '@scspace-server/common/utils';
import { RentalRepository } from './rental.repository';
import { RentalPublicService } from './rental.public.service';
import { UserPublicService } from '../user/user.public.service';
import { IUser } from '@scspace-depot/types/user';
import {
  RENTAL_CERTIFICATE_PENDING,
  RENTAL_DUTY_HOURS,
} from '@scspace-depot/consts/rental.const';
import { FileService } from '@scspace-server/tools/file/file.service';
import { PdfService } from '@scspace-server/tools/pdf/pdf.service';
import { ICertificatePdf } from '@scspace-depot/types/pdf/pdf.type';
import { MailService } from '@scspace-server/tools/mailer/mail.service';
import { RentalMeta } from '@scspace-depot/enums/mail.enum';
import { RentalStatusEnum } from '@scspace-depot/enums/rental.enum';
import { UserUtils } from '@scspace-depot/utils/user.utils';
import { PRIVATE_FOLDER } from '@scspace-depot/consts/file.const';
import { basename, resolve } from 'path';
import { Temporal } from '@js-temporal/polyfill';
import { BUSINESS_TIME_ZONE } from '@scspace-server/common/utils';

@Injectable()
export class RentalService {
  constructor(
    private readonly rentalRepository: RentalRepository,
    private readonly rentalPublicService: RentalPublicService,
    private readonly userPublicService: UserPublicService,
    private readonly fileService: FileService,
    private readonly pdfService: PdfService,
    private readonly mailService: MailService,
  ) {}

  async createRentalAdmin(
    rentalData: IRentalCreateAdmin & { approverId: number },
  ): Promise<{ success: boolean; data: { id: number } }> {
    this.assertDutyHours();

    const {
      userId,
      goodsId,
      count,
      timeDue,
      groupName,
      contact,
      emergencyContact,
      usingLocation,
      usingPurpose,
      approverId,
    } = rentalData;

    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new BadRequestException('Rental count must be a positive integer');
    }
    if (!Number.isSafeInteger(timeDue) || timeDue <= getNow()) {
      throw new BadRequestException('Rental due time must be in the future');
    }
    if (
      ![
        groupName,
        contact,
        emergencyContact,
        usingLocation,
        usingPurpose,
      ].every((value) => value?.trim())
    ) {
      throw new BadRequestException(
        'Organization, contacts, location, and purpose are required',
      );
    }

    const [user, goods] = await Promise.all([
      this.userPublicService.fetchById(userId),
      this.rentalPublicService.getGoodsById(goodsId),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }

    const now = getNow();

    const availability: IGoodsAvailabilityCheck = {
      goodsId,
      count,
      timeBorrow: now,
      timeDue,
    };

    const isAvailable =
      await this.rentalPublicService.checkGoodsAvailability(availability);
    if (!isAvailable) {
      throw new BadRequestException(
        'Requested goods are not available for the specified period',
      );
    }

    const id = await this.rentalRepository.createRentalWithAtomicStock({
      userId,
      goodsId,
      count,
      timeBorrow: now,
      timeDue,
      groupName: groupName || null,
      contact: contact || null,
      emergencyContact: emergencyContact || null,
      usingLocation: usingLocation || null,
      usingPurpose: usingPurpose || null,
      approverId,
      status: RentalStatusEnum.ACTIVE,
    });

    if (!id) {
      throw new BadRequestException('Insufficient stock');
    }

    try {
      const meta: ICertificatePdf = {
        id,
        user,
        goods,
        contact: contact || user.email,
        rentalFrom: getDateString(now),
        rentalTo: getDateString(timeDue),
        rentalDuration: Math.ceil(
          getDateDiffInMinute(now, timeDue) / (60 * 24),
        ),
        rentalQuantity: count,
      };

      await this.replaceRentalCertificate(meta);

      await this.mailService.sendMail({
        to: 'scspace.kaist@gmail.com',
        bcc: 'jhlee012@kaist.ac.kr',
        template: 'rentalNotif',
        subject: '[SCSpace] 새로운 대여가 있습니다.',
        context: {
          meta,
        },
      });
    } catch (error) {
      await this.reportSideEffectError(
        error,
        'rental.service.ts > createRentalAdmin',
      );
    }

    return {
      success: true,
      data: { id },
    };
  }

  async getRentalById(id: number, actor: IUser): Promise<IRentalAll> {
    const rental = await this.rentalPublicService.getRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    if (rental.userId !== actor.id && !UserUtils.isManager(actor.type)) {
      throw new ForbiddenException('You can only access your own rentals');
    }

    const [user, goods, approver, returnApprover, overdueContactedBy] =
      await Promise.all([
        this.userPublicService.fetchById(rental.userId),
        this.rentalPublicService.getGoodsById(rental.goodsId),
        rental.approverId
          ? this.userPublicService.fetchById(rental.approverId)
          : null,
        rental.returnApproverId
          ? this.userPublicService.fetchById(rental.returnApproverId)
          : null,
        rental.overdueContactedById
          ? this.userPublicService.fetchById(rental.overdueContactedById)
          : null,
      ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }

    return {
      ...rental,
      user,
      goods,
      approver,
      returnApprover,
      overdueContactedBy,
    };
  }

  async getRentalCertificate(id: number, actor: IUser): Promise<string> {
    const rental = await this.rentalPublicService.getRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    if (rental.userId !== actor.id && !UserUtils.isManager(actor.type)) {
      throw new ForbiddenException(
        'You can only access your own rental certificate',
      );
    }

    if (!rental.certName || basename(rental.certName) !== rental.certName) {
      throw new BadRequestException('Invalid rental certificate');
    }

    const filePath = resolve(PRIVATE_FOLDER, rental.certName);
    await this.fileService.fileExistValidator(filePath);
    return filePath;
  }

  async getRentalList(
    limit: number = 50,
    offset: number = 0,
  ): Promise<IDataResponse<IRentalAll[]>> {
    const { data: rentals, count } =
      await this.rentalRepository.fetchAllRentals(limit, offset);

    if (rentals.length === 0) {
      return { data: [], count };
    }

    const userIds = [
      ...new Set(
        rentals.flatMap((rental) =>
          [
            rental.userId,
            rental.approverId,
            rental.returnApproverId,
            rental.overdueContactedById,
          ].filter((id): id is number => id !== null),
        ),
      ),
    ];
    const goodsIds = [...new Set(rentals.map((r) => r.goodsId))];

    const [users, goods] = (await Promise.all([
      this.userPublicService
        .fetchAllByIds(userIds)
        .then(takeAll(userIds, 'users')),
      this.rentalPublicService.getGoodsByIds(goodsIds),
    ])) as [IUser[], IGoods[]];

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(goodsIds, goods, 'goods');

    const rentalsWithDetails = rentals.map((rental) => ({
      ...rental,
      user: users.find((u) => u.id === rental.userId)!,
      goods: goods.find((g) => g.id === rental.goodsId)!,
      approver: users.find((u) => u.id === rental.approverId) ?? null,
      returnApprover:
        users.find((u) => u.id === rental.returnApproverId) ?? null,
      overdueContactedBy:
        users.find((u) => u.id === rental.overdueContactedById) ?? null,
    }));

    return {
      data: rentalsWithDetails,
      count,
    };
  }

  async getUserRentals(
    params: IUserRentalStatus,
  ): Promise<IDataResponse<IRentalAll[]>> {
    const { userId, isActive, limit = 50, offset = 0 } = params;

    const { data: rentals, count } =
      await this.rentalPublicService.getRentalsByUserId(
        userId,
        isActive,
        limit,
        offset,
      );

    if (rentals.length === 0) {
      return { data: [], count };
    }

    const goodsIds = [...new Set(rentals.map((r) => r.goodsId))];
    const relatedUserIds = [
      ...new Set(
        rentals.flatMap((rental) =>
          [
            rental.userId,
            rental.approverId,
            rental.returnApproverId,
            rental.overdueContactedById,
          ].filter((id): id is number => id !== null),
        ),
      ),
    ];
    const [users, goods] = await Promise.all([
      this.userPublicService.fetchAllByIds(relatedUserIds),
      this.rentalPublicService.getGoodsByIds(goodsIds),
    ]);

    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    checkContainAllId(goodsIds, goods, 'goods');

    const rentalsWithDetails = rentals.map((rental) => ({
      ...rental,
      user,
      goods: goods.find((g) => g.id === rental.goodsId)!,
      approver: users.find((u) => u.id === rental.approverId) ?? null,
      returnApprover:
        users.find((u) => u.id === rental.returnApproverId) ?? null,
      overdueContactedBy:
        users.find((u) => u.id === rental.overdueContactedById) ?? null,
    }));

    return { data: rentalsWithDetails, count };
  }

  async confirmReturn(id: number, actor: IUser): Promise<ISuccessResponse> {
    if (!UserUtils.isManager(actor.type)) {
      throw new ForbiddenException('Only managers can confirm returns');
    }
    this.assertDutyHours();

    const rental = await this.rentalPublicService.getRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    if (
      rental.status !== RentalStatusEnum.ACTIVE &&
      rental.status !== RentalStatusEnum.RETURNED
    ) {
      throw new BadRequestException('This rental cannot be returned');
    }

    if (rental.timeConfirm !== 0) {
      throw new BadRequestException('This return has already been confirmed');
    }

    // 연체된 대여인지 확인
    const returnTime = rental.timeReturn > 0 ? rental.timeReturn : getNow();
    const isOverdue = rental.timeDue < returnTime;
    let overdueDays: number | undefined;

    if (isOverdue) {
      overdueDays = Math.ceil(
        getDateDiffInMinute(rental.timeDue, returnTime) / (60 * 24),
      );
    }

    const confirmed = await this.rentalRepository.confirmReturnWithStock({
      id,
      goodsId: rental.goodsId,
      count: rental.count,
      userId: rental.userId,
      timeDue: rental.timeDue,
      expectedTimeReturn: rental.timeReturn,
      timeReturn: returnTime,
      timeConfirm: getNow(),
      returnApproverId: actor.id,
      overdueDays,
    });
    if (!confirmed) {
      throw new BadRequestException('This return has already been confirmed');
    }

    try {
      await this.fileService.deletePrivateFile(rental.certName);
    } catch (error) {
      Logger.error(
        'Failed to delete rental certificate after return confirmation',
        error,
      );
    }

    //mailer << Unnecessary - Currently Delayed

    return { success: true };
  }

  async updateRentalAdmin(
    id: number,
    updates: IRentalUpdateAdmin,
    actor: IUser,
  ): Promise<ISuccessResponse> {
    if (!UserUtils.isManager(actor.type)) {
      throw new ForbiddenException('Only managers can update rentals');
    }

    const rental = await this.rentalRepository.fetchRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }
    if (rental.status !== RentalStatusEnum.ACTIVE) {
      throw new BadRequestException('Only active rentals can be updated');
    }

    const count = updates.count ?? rental.count;
    const timeDue = updates.timeDue ?? rental.timeDue;
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new BadRequestException('Rental count must be a positive integer');
    }
    if (!Number.isSafeInteger(timeDue) || timeDue <= rental.timeBorrow) {
      throw new BadRequestException(
        'Rental due time must be after the borrow time',
      );
    }

    const textUpdates = [
      updates.groupName,
      updates.contact,
      updates.emergencyContact,
      updates.usingLocation,
      updates.usingPurpose,
    ];
    if (textUpdates.some((value) => value !== undefined && !value.trim())) {
      throw new BadRequestException('Rental detail fields cannot be empty');
    }

    const nextUserId = updates.userId ?? rental.userId;
    const nextGoodsId = updates.goodsId ?? rental.goodsId;
    const [user, goods] = await Promise.all([
      this.userPublicService.fetchById(nextUserId),
      this.rentalPublicService.getGoodsById(nextGoodsId),
    ]);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }

    const allowedUpdates: IRentalUpdateAdmin = {
      ...(updates.userId !== undefined ? { userId: updates.userId } : {}),
      ...(updates.goodsId !== undefined ? { goodsId: updates.goodsId } : {}),
      count,
      timeDue,
      ...(updates.groupName !== undefined
        ? { groupName: updates.groupName }
        : {}),
      ...(updates.contact !== undefined ? { contact: updates.contact } : {}),
      ...(updates.emergencyContact !== undefined
        ? { emergencyContact: updates.emergencyContact }
        : {}),
      ...(updates.usingLocation !== undefined
        ? { usingLocation: updates.usingLocation }
        : {}),
      ...(updates.usingPurpose !== undefined
        ? { usingPurpose: updates.usingPurpose }
        : {}),
    };
    const updated = await this.rentalRepository.updateActiveRentalWithStock(
      rental,
      allowedUpdates,
    );
    if (!updated) {
      throw new BadRequestException(
        'Rental changed concurrently; reload and try again',
      );
    }

    try {
      await this.replaceRentalCertificate(
        {
          id,
          user,
          goods,
          contact: allowedUpdates.contact ?? rental.contact ?? user.email,
          rentalFrom: getDateString(rental.timeBorrow),
          rentalTo: getDateString(timeDue),
          rentalDuration: Math.ceil(
            getDateDiffInMinute(rental.timeBorrow, timeDue) / (60 * 24),
          ),
          rentalQuantity: count,
        },
        rental.certName,
      );
    } catch (error) {
      await this.reportSideEffectError(
        error,
        'rental.service.ts > updateRentalAdmin',
      );
    }
    return { success: true };
  }

  async cancelRental(id: number, actor: IUser): Promise<ISuccessResponse> {
    if (!UserUtils.isManager(actor.type)) {
      throw new ForbiddenException('Only managers can cancel rentals');
    }
    const rental = await this.rentalPublicService.getRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }
    const cancelled = await this.rentalRepository.cancelRentalWithStock({
      id,
      goodsId: rental.goodsId,
      count: rental.count,
    });
    if (!cancelled) {
      throw new BadRequestException('Only active rentals can be cancelled');
    }
    try {
      await this.fileService.deletePrivateFile(rental.certName);
    } catch (error) {
      Logger.error(
        'Failed to delete rental certificate after cancellation',
        error,
      );
    }
    return { success: true };
  }

  async markOverdueContacted(
    id: number,
    actor: IUser,
  ): Promise<ISuccessResponse> {
    if (!UserUtils.isManager(actor.type)) {
      throw new ForbiddenException('Only managers can record overdue contact');
    }
    const contacted = await this.rentalRepository.markOverdueContacted({
      id,
      contactedAt: getNow(),
      contactedById: actor.id,
    });
    if (!contacted) {
      throw new BadRequestException(
        'Only an uncontacted overdue rental can be updated',
      );
    }
    return { success: true };
  }

  // Goods 관련 서비스 메서드들
  async createGoods(
    goodsData: IGoodsCreate,
  ): Promise<{ success: boolean; data: { id: number } }> {
    const id = await this.rentalRepository.createGoods(goodsData);
    return {
      success: true,
      data: { id },
    };
  }

  async getGoodsById(id: number): Promise<IGoods> {
    const goods = await this.rentalPublicService.getGoodsById(id);
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }
    return goods;
  }

  async getGoodsList(): Promise<IGoods[]> {
    return await this.rentalPublicService.getAllGoods();
  }

  async updateGoods(
    id: number,
    updates: IGoodsUpdate,
  ): Promise<ISuccessResponse> {
    const existingGoods = await this.rentalPublicService.getGoodsById(id);
    if (!existingGoods) {
      throw new NotFoundException('Goods not found');
    }

    const { countAll } = updates;
    const details: Omit<IGoodsUpdate, 'countAll' | 'countNow'> = {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined
        ? { description: updates.description }
        : {}),
      ...(updates.imageURI !== undefined ? { imageURI: updates.imageURI } : {}),
    };
    if (countAll !== undefined) {
      if (!Number.isSafeInteger(countAll) || countAll < 0) {
        throw new BadRequestException(
          'Total stock must be a non-negative integer',
        );
      }
      const updated = await this.rentalRepository.updateGoodsInventory(
        id,
        countAll,
        details,
      );
      if (!updated) {
        throw new BadRequestException(
          'Total stock cannot be lower than the borrowed quantity',
        );
      }
    } else {
      await this.rentalRepository.updateGoods(id, details);
    }

    if (updates.imageURI && existingGoods.imageURI !== updates.imageURI) {
      try {
        await this.fileService.deletePublicFile(existingGoods.imageURI);
      } catch (error) {
        Logger.error('Failed to delete the previous goods image', error);
      }
    }

    return { success: true };
  }

  async deleteGoods(id: number): Promise<ISuccessResponse> {
    const goods = await this.rentalPublicService.getGoodsById(id);
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }

    if (!(await this.rentalRepository.deleteGoodsIfUnused(id))) {
      throw new BadRequestException('Cannot delete goods with rental history');
    }

    try {
      await this.fileService.deletePublicFile(goods.imageURI);
    } catch (error) {
      Logger.error(
        'Failed to delete the goods image after removing inventory',
        error,
      );
    }
    return { success: true };
  }
  async getOverdueRentals(): Promise<IRentalAll[]> {
    const overdueRentals = await this.rentalPublicService.getOverdueRentals();

    if (overdueRentals.length === 0) {
      return [];
    }

    const userIds = [
      ...new Set(
        overdueRentals.flatMap((rental) =>
          [
            rental.userId,
            rental.approverId,
            rental.returnApproverId,
            rental.overdueContactedById,
          ].filter((id): id is number => id !== null),
        ),
      ),
    ];
    const goodsIds = [...new Set(overdueRentals.map((r) => r.goodsId))];

    const [users, goods] = (await Promise.all([
      this.userPublicService
        .fetchAllByIds(userIds)
        .then(takeAll(userIds, 'users')),
      this.rentalPublicService.getGoodsByIds(goodsIds),
    ])) as [IUser[], IGoods[]];

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(goodsIds, goods, 'goods');

    return overdueRentals.map((rental) => ({
      ...rental,
      user: users.find((u) => u.id === rental.userId)!,
      goods: goods.find((g) => g.id === rental.goodsId)!,
      approver: users.find((u) => u.id === rental.approverId) ?? null,
      returnApprover:
        users.find((u) => u.id === rental.returnApproverId) ?? null,
      overdueContactedBy:
        users.find((u) => u.id === rental.overdueContactedById) ?? null,
    }));
  }

  //send return request mail to specific rental (FYI : overdue not required)
  async rentalReturnRequest(id: number): Promise<{
    success: boolean;
    id: number;
  }> {
    const rental = await this.rentalPublicService.getRentalById(id);
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }
    const goods = await this.rentalPublicService.getGoodsById(rental.goodsId);
    if (!goods) {
      throw new NotFoundException('Goods not found');
    }
    const user = await this.userPublicService.fetchById(rental.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const meta = RentalMeta.requestReturn;

    const dates = {
      timeFrom: getDateString(rental.timeBorrow),
      timeTo: getDateString(rental.timeDue),
      overdue:
        rental.timeDue < getNow()
          ? String(
              Math.ceil(
                getDateDiffInMinute(rental.timeDue, getNow()) / (60 * 24),
              ),
            )
          : '0',
    };

    const rentalMeta = {
      title: goods.name,
      user: user,
      timeFrom: dates.timeFrom,
      timeTo: dates.timeTo,
      overdue: dates.overdue,
    };

    try {
      Logger.log(
        'Sending Return Request mail for Rental ID : ' +
          id +
          ' by User : ' +
          user.nameKr +
          '',
      );
      Logger.log(meta);
      Logger.log(rentalMeta);
      await this.mailService.sendMail({
        to: user.email,
        bcc: 'jhlee012@kaist.ac.kr',
        template: 'rentalReturnReq',
        subject: '[SCSpace] 대여 기한 만료 안내 및 반납 요청',
        context: {
          meta: meta,
          rental: rentalMeta,
        },
      });
    } catch (error) {
      Logger.error(error);
      await this.mailService.reportError(
        error instanceof Error ? error : new Error(String(error)),
        'Rental Return Request - Mail Sector',
      );
    }

    return {
      success: true,
      id: id,
    };
  }

  //send request return mail to all overdue rentals
  async rentalReturnRequestAll(): Promise<
    {
      success: boolean;
      id: number;
    }[]
  > {
    const rentals = await this.rentalPublicService.getOverdueRentals();
    const res = await Promise.allSettled(
      rentals.map((r) => this.rentalReturnRequest(r.id)),
    );
    return res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  }

  private async reportSideEffectError(
    error: unknown,
    context: string,
  ): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    Logger.error(err.message, err.stack, context);

    try {
      await this.mailService.reportError(err, context);
    } catch (reportError) {
      const reportErr =
        reportError instanceof Error
          ? reportError
          : new Error(String(reportError));
      Logger.error(
        reportErr.message,
        reportErr.stack,
        `${context} > reportError`,
      );
    }
  }

  private async replaceRentalCertificate(
    meta: ICertificatePdf,
    previousFilename?: string,
  ): Promise<void> {
    const result = await this.pdfService.createAndStoreRentalCert(meta);
    const linked = await this.rentalRepository.updateRentalCert(
      meta.id,
      result.filename,
    );
    if (!linked) {
      await this.fileService.deletePrivateFile(result.filename);
      return;
    }

    if (previousFilename && previousFilename !== RENTAL_CERTIFICATE_PENDING) {
      try {
        await this.fileService.deletePrivateFile(previousFilename);
      } catch (error) {
        Logger.error('Failed to delete the previous rental certificate', error);
      }
    }
  }

  private assertDutyHours(): void {
    const now = Temporal.Now.zonedDateTimeISO(BUSINESS_TIME_ZONE);
    const minute = now.hour * 60 + now.minute;
    const isDutyHours = RENTAL_DUTY_HOURS.some(
      (period) =>
        period.dayOfWeek === now.dayOfWeek &&
        period.startMinute <= minute &&
        minute < period.endMinute,
    );
    if (!isDutyHours) {
      throw new BadRequestException(
        'Rentals are available only during committee duty hours',
      );
    }
  }
}
