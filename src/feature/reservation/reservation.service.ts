import {
  IReservationCreate,
  IReservationUpdate,
  IReservationAll,
  IReservationContent,
  IReservation,
  IReservationApplyWorker,
  IReservationApprovalRequest,
} from '@scspace-depot/types/reservation';
import { IOrganization } from '@scspace-depot/types/organization';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { checkContainAllId, takeAll } from '@scspace-server/common/utils';
import { ReservationStateEnum } from '@scspace-depot/enums/reservation.enum';
import { IUser } from '@scspace-depot/types/user';
import { ISpace } from '@scspace-depot/types/space';
import { MReservation } from '@scspace-server/feature/reservation/reservation.model';
import { IDataResponse, ISuccessResponse } from '@scspace-depot/types/common';
import { MailService } from '@scspace-server/tools/mailer/mail.service';
import { ReservationMeta, WorkerMeta } from '@scspace-depot/enums/mail.enum';
import { getString } from '@scspace-server/common/utils';
import { ReservationRepository } from '@scspace-server/feature/reservation/reservation.repository';
import { ReservationPublicService } from '@scspace-server/feature/reservation/reservation.public.service';
import { SpacePublicService } from '@scspace-server/feature/space/space.public.service';
import { UserPublicService } from '@scspace-server/feature/user/user.public.service';
import { OrganizationPublicService } from '@scspace-server/feature/organization/organization.public.service';
import { UserUtils } from '@scspace-depot/utils/user.utils';
import { SpaceTypeEnum } from '@scspace-depot/enums/space.enum';

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly reservationPublicService: ReservationPublicService,
    private readonly spacePublicService: SpacePublicService,
    private readonly userPublicService: UserPublicService,
    private readonly organizationPublicService: OrganizationPublicService,
    private readonly mailService: MailService,
  ) {}

  private async reportMailError(
    error: unknown,
    context: string,
  ): Promise<void> {
    try {
      await this.mailService.reportError(
        error instanceof Error ? error : new Error(String(error)),
        context,
      );
    } catch (reportError) {
      this.logger.error('예약 메일 오류 보고 실패', reportError);
    }
  }

  async getReservationListByUserId(
    userId: number,
    organizationId: number,
    limit: number,
    offset: number,
  ): Promise<IDataResponse<IReservationAll[]>> {
    const { data: reservations, count } =
      await this.reservationRepository.fetchByUserId(
        userId,
        organizationId,
        limit,
        offset,
      );

    const userIds = reservations.map((r) => r.userId);
    const organizationIds = reservations.map((r) => r.organizationId);
    const spaceIds = reservations.map((r) => r.spaceId);

    const [users, organizations, spaces, reservationContents] =
      (await Promise.all([
        this.userPublicService
          .fetchAllByIds(userIds)
          .then(takeAll(userIds, 'users')),
        this.organizationPublicService.fetchByIds(organizationIds),
        this.spacePublicService.fetchAllByIds(spaceIds),
        this.reservationPublicService.getReservationContentByIds(
          reservations.map((reservation) => reservation.id),
        ),
      ])) as [IUser[], IOrganization[], ISpace[], IReservationContent[]];

    const workerIds = reservationContents
      .map((content) => content.workerId)
      .filter((id) => id !== 0);
    const workers = await this.userPublicService
      .fetchAllByIds(workerIds)
      .then(takeAll(workerIds, 'workers'));

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(organizationIds, organizations, 'organizations');
    checkContainAllId(spaceIds, spaces, 'spaces');
    checkContainAllId(workerIds, workers, 'workers');

    return {
      data: reservations.map((reservation) => {
        const content = reservationContents.find(
          (content) => content.id === reservation.id,
        )!;
        return {
          ...reservation,
          user: users.find((user) => user.id === reservation.userId)!,
          organization: organizations.find(
            (org) => org.id === reservation.organizationId,
          )!,
          space: spaces.find((space) => space.id === reservation.spaceId)!,
          worker:
            content.workerId === 0
              ? null
              : workers.find((worker) => worker.id === content.workerId)!,
          content,
        };
      }),
      count,
    };
  }

  async getReservationList(
    organizationId: number,
    limit: number,
    offset: number,
  ): Promise<IDataResponse<IReservationAll[]>> {
    const { data: reservations, count } =
      await this.reservationRepository.fetch({
        organizationId,
        limit,
        offset,
      });

    const userIds = reservations.map((reservation) => reservation.userId);
    const organizationIds = reservations.map(
      (reservation) => reservation.organizationId,
    );
    const spaceIds = reservations.map((reservation) => reservation.spaceId);

    const [users, organizations, spaces, reservationContents] =
      (await Promise.all([
        this.userPublicService
          .fetchAllByIds(userIds)
          .then(takeAll(userIds, 'users')),
        this.organizationPublicService.fetchByIds(organizationIds),
        this.spacePublicService.fetchAllByIds(spaceIds),
        this.reservationPublicService.getReservationContentByIds(
          reservations.map((reservation) => reservation.id),
        ),
      ])) as [IUser[], IOrganization[], ISpace[], IReservationContent[]];

    const workerIds = reservationContents
      .map((content) => content.workerId)
      .filter((id) => id !== 0);
    const workers = await this.userPublicService
      .fetchAllByIds(workerIds)
      .then(takeAll(workerIds, 'workers'));

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(organizationIds, organizations, 'organizations');
    checkContainAllId(spaceIds, spaces, 'spaces');
    checkContainAllId(workerIds, workers, 'workers');

    return {
      data: reservations.map((reservation) => {
        const content = reservationContents.find(
          (content) => content.id === reservation.id,
        )!;
        return {
          ...reservation,
          user: users.find((user) => user.id === reservation.userId)!,
          organization: organizations.find(
            (org) => org.id === reservation.organizationId,
          )!,
          space: spaces.find((space) => space.id === reservation.spaceId)!,
          worker:
            content.workerId === 0
              ? null
              : workers.find((worker) => worker.id === content.workerId)!,
          content,
        };
      }),
      count,
    };
  }
  // 사용안함
  // private getDefaultStatus(spaceType: SpaceTypeEnum): ReservationStateEnum {
  //   switch (spaceType) {
  //     // 기본적으로 GRANT 상태로 예약
  //     case SpaceTypeEnum.INDIVIDUAL:
  //     case SpaceTypeEnum.PIANO:
  //     case SpaceTypeEnum.SEMINAR:
  //     case SpaceTypeEnum.DANCE:
  //     case SpaceTypeEnum.GROUP:
  //     case SpaceTypeEnum.OPEN:
  //     case SpaceTypeEnum.WORK:
  //       return ReservationStateEnum.GRANT;
  //     // WAIT 상태로 예약
  //     case SpaceTypeEnum.MIRAE:
  //     case SpaceTypeEnum.SUMI:
  //       return ReservationStateEnum.WAIT;
  //   }
  // }

  async getWorkHistory(userId: number) {
    const reservations =
      await this.reservationRepository.fetchByWorkerId(userId);

    const userIds = reservations.map((reservation) => reservation.userId);
    const organizationIds = reservations.map(
      (reservation) => reservation.organizationId,
    );
    const spaceIds = reservations.map((reservation) => reservation.spaceId);

    const [users, organizations, spaces, reservationContents] =
      (await Promise.all([
        this.userPublicService
          .fetchAllByIds(userIds)
          .then(takeAll(userIds, 'users')),
        this.organizationPublicService.fetchByIds(organizationIds),
        this.spacePublicService.fetchAllByIds(spaceIds),
        this.reservationPublicService.getReservationContentByIds(
          reservations.map((reservation) => reservation.id),
        ),
      ])) as [IUser[], IOrganization[], ISpace[], IReservationContent[]];

    const workerIds = reservationContents
      .map((content) => content.workerId)
      .filter((id) => id !== 0);
    const workers = await this.userPublicService
      .fetchAllByIds(workerIds)
      .then(takeAll(workerIds, 'workers'));

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(organizationIds, organizations, 'organizations');
    checkContainAllId(spaceIds, spaces, 'spaces');
    checkContainAllId(workerIds, workers, 'workers');

    return reservations.map((reservation) => {
      const content = reservationContents.find(
        (content) => content.id === reservation.id,
      )!;
      return {
        ...reservation,
        user: users.find((user) => user.id === reservation.userId)!,
        organization: organizations.find(
          (org) => org.id === reservation.organizationId,
        )!,
        space: spaces.find((space) => space.id === reservation.spaceId)!,
        worker:
          content.workerId === 0
            ? null
            : workers.find((worker) => worker.id === content.workerId)!,
        content,
      };
    });
  }

  async getWorkNeeds() {
    const reservations = await this.reservationRepository.fetchWorkNeeds();

    const userIds = reservations.map((reservation) => reservation.userId);
    const organizationIds = reservations.map(
      (reservation) => reservation.organizationId,
    );
    const spaceIds = reservations.map((reservation) => reservation.spaceId);

    const [users, organizations, spaces, reservationContents] =
      (await Promise.all([
        this.userPublicService
          .fetchAllByIds(userIds)
          .then(takeAll(userIds, 'users')),
        this.organizationPublicService.fetchByIds(organizationIds),
        this.spacePublicService.fetchAllByIds(spaceIds),
        this.reservationPublicService.getReservationContentByIds(
          reservations.map((reservation) => reservation.id),
        ),
      ])) as [IUser[], IOrganization[], ISpace[], IReservationContent[]];

    const workerIds = reservationContents
      .map((content) => content.workerId)
      .filter((id) => id !== 0);
    const workers = await this.userPublicService
      .fetchAllByIds(workerIds)
      .then(takeAll(workerIds, 'workers'));

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(organizationIds, organizations, 'organizations');
    checkContainAllId(spaceIds, spaces, 'spaces');
    checkContainAllId(workerIds, workers, 'workers');

    return reservations.map((reservation) => {
      const content = reservationContents.find(
        (content) => content.id === reservation.id,
      )!;
      return {
        ...reservation,
        user: users.find((user) => user.id === reservation.userId)!,
        organization: organizations.find(
          (org) => org.id === reservation.organizationId,
        )!,
        space: spaces.find((space) => space.id === reservation.spaceId)!,
        worker:
          content.workerId === 0
            ? null
            : workers.find((worker) => worker.id === content.workerId)!,
        content,
      };
    });
  }

  async postReservation(
    reservationInput: IReservationCreate,
    actor: IUser,
  ): Promise<IReservation> {
    if (
      !UserUtils.isManager(actor.type) &&
      reservationInput.userId !== actor.id
    ) {
      throw new ForbiddenException(
        'Users can only create reservations in their own name',
      );
    }

    const safeReservationInput: IReservationCreate = {
      userId: UserUtils.isManager(actor.type)
        ? reservationInput.userId
        : actor.id,
      organizationId: reservationInput.organizationId,
      spaceId: reservationInput.spaceId,
      title: reservationInput.title,
      timeFrom: reservationInput.timeFrom,
      timeTo: reservationInput.timeTo,
      content: {
        description: reservationInput.content.description,
        innerParticipantNumber: reservationInput.content.innerParticipantNumber,
        outerParticipantNumber: reservationInput.content.outerParticipantNumber,
        food: reservationInput.content.food,
        busking: reservationInput.content.busking,
        workerNeed: reservationInput.content.workerNeed,
        workerNeedReason: reservationInput.content.workerNeedReason,
      },
    };

    await this.reservationPublicService.checkWholeTime(
      safeReservationInput.userId,
      safeReservationInput.organizationId,
      safeReservationInput.spaceId,
      safeReservationInput.timeFrom,
      safeReservationInput.timeTo,
    );

    const [user, organization, space] = await Promise.all([
      this.userPublicService.fetchById(safeReservationInput.userId),
      this.organizationPublicService.fetchById(
        safeReservationInput.organizationId,
      ),
      this.spacePublicService.fetchById(safeReservationInput.spaceId),
    ]);

    if (!user) throw new BadRequestException('User not found');
    if (!organization) throw new BadRequestException('Organization not found');
    if (!space) throw new BadRequestException('Space not found');

    if (!UserUtils.isManager(user.type)) {
      const userOrganizations =
        await this.organizationPublicService.fetchByUserId(
          safeReservationInput.userId,
        );
      if (
        !userOrganizations.some(
          (org) => org.id === safeReservationInput.organizationId,
        )
      ) {
        throw new BadRequestException(
          'User does not belong to the specified organization',
        );
      }
    }

    await this.reservationPublicService.validateSpaceTimeConstraints(
      safeReservationInput.userId,
      safeReservationInput.organizationId,
      space,
      safeReservationInput.timeFrom,
      safeReservationInput.timeTo,
    );

    // 세미나실 추첨 기간 겹침 검증
    await this.reservationPublicService.validateSeminarLotteryConflict(
      safeReservationInput.userId,
      space,
      safeReservationInput.timeFrom,
      safeReservationInput.timeTo,
    );

    await this.reservationPublicService.validatePerformanceLotteryConflict(
      safeReservationInput.userId,
      space,
      safeReservationInput.timeFrom,
      safeReservationInput.timeTo,
    );

    const requiresApproval =
      !UserUtils.isManager(actor.type) &&
      (space.spaceType === SpaceTypeEnum.MIRAE ||
        space.spaceType === SpaceTypeEnum.SUMI);
    const [reservation, reservationContent] =
      await this.reservationRepository.insert(
        safeReservationInput,
        requiresApproval
          ? ReservationStateEnum.WAIT
          : ReservationStateEnum.GRANT,
      );

    const timeFrom = getString(reservation.timeFrom);
    const timeTo = getString(reservation.timeTo);
    const workerNeed: boolean = reservationContent.workerNeed;

    const templateFooter: string =
      organization.id === 1
        ? '문의사항이 있으시면 언제든 연락해 주세요.'
        : '이 메일은 예약자 본인 및 조직에 등록된 모든 구성원에게 발송되었습니다.';
    const templateFooterEn: string =
      organization.id === 1
        ? 'Please feel free to contact us if you have any questions.'
        : 'This email has been sent to the reservation holder and all members registered with the organization.';
    const reservationMeta =
      reservation.state === ReservationStateEnum.WAIT
        ? ReservationMeta.ReservationPending
        : ReservationMeta.ReservationCompleted;
    const meta = {
      ...reservationMeta,
      timeFrom,
      timeTo,
      templateFooter,
      templateFooterEn,
    };

    try {
      const organizationWithMembers =
        organization.id !== 1
          ? await this.organizationPublicService.fetchDeepById(organization.id)
          : undefined;
      if (!organizationWithMembers && organization.id !== 1) {
        throw new Error('Organization fetch error');
      }

      await this.mailService.sendMail({
        to:
          organization.id === 1
            ? user.email
            : organizationWithMembers.members.map(
                (member) => member.user.email,
              ),
        subject:
          reservation.state === ReservationStateEnum.WAIT
            ? `[SCSpace] Reservation Pending Approval - ${reservation.title}`
            : `[SCSpace] Reservation Confirmed - ${reservation.title}`,
        // bcc: 'scspace.kaist@gmail.com',
        template: 'reservationPosted',
        replyTo: 'scspace@kaist.ac.kr',
        context: {
          reservation: {
            ...reservation,
            user,
            space,
            organization,
            workerNeed,
          },
          meta,
        },
      });

      if (workerNeed && reservation.state === ReservationStateEnum.GRANT) {
        const workers = await this.userPublicService.fetchAllWorker();

        const workerMeta = {
          ...ReservationMeta.WorkerNotif,
          timeTo,
          timeFrom,
        };

        await this.mailService.sendMail({
          to: workers.map((worker) => worker.email),
          subject: `[SCSpace] New Work-Request Reservation Created`,
          cc: 'scspace.kaist@gmail.com', // for scspace workers
          bcc: 'jhlee012@kaist.ac.kr',
          template: 'reservationPosted',
          replyTo: 'scspace@kaist.ac.kr',
          context: {
            reservation: {
              ...reservation,
              user,
              space,
              organization,
              workerNeed,
            },
            workerMail: true,
            meta: workerMeta,
          },
        });
      }
    } catch (error) {
      Logger.error(error);
      await this.reportMailError(error, 'Post New Reservation - Mail Sector');
    }

    if (workerNeed && safeReservationInput.content.workerNeedReason) {
      try {
        await this.mailService.sendMail({
          to: 'scspace.kaist@gmail.com',
          subject: `근로 요청 이유: ${user.nameKr}`,
          template: 'workerNeedReason',
          context: {
            meta: {
              description: safeReservationInput.content.workerNeedReason,
            },
          },
        });
      } catch (error) {
        Logger.error(error);
        await this.reportMailError(
          error,
          'Post Worker Request Reason - Mail Sector',
        );
      }
    }

    return MReservation.fromDB(reservation, reservationContent);
  }

  async assignWorker(param: IReservationApplyWorker) {
    const { id, workerId } = param;
    const { data: reservation } = await this.reservationRepository.fetch({
      id,
    });

    if (reservation.length === 0) {
      throw new NotFoundException('Reservation not found');
    }

    const worker = await this.userPublicService.fetchById(workerId);

    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    const [reservationUpdated, reservationContentUpdated] =
      await this.reservationRepository.updateWorker(
        reservation[0].id,
        workerId,
      );

    //MAILER

    try {
      //mail const
      const timeFrom = getString(reservationUpdated.timeFrom);
      const timeTo = getString(reservationUpdated.timeTo);

      const user = await this.userPublicService.fetchById(
        reservationUpdated.userId,
      );
      const organizationName =
        reservationUpdated.organizationId === 1
          ? 'individual'
          : await this.organizationPublicService
              .fetchById(reservationUpdated.organizationId)
              .then((org) => org.name);
      const space = await this.spacePublicService.fetchById(
        reservationUpdated.spaceId,
      );

      const metaWorker = {
        meta: {
          ...WorkerMeta.forWorker,
          timeFrom,
          timeTo,
        },
        reservation: reservationUpdated,
        worker: worker,
        user: user,
        organizationName: organizationName,
        space: space,
      };

      const metaAuthor = {
        meta: {
          ...WorkerMeta.forAuthor,
          timeFrom,
          timeTo,
        },
        reservation: reservationUpdated,
        worker: worker,
        user: user,
        organizationName: organizationName,
        space: space,
      };

      //Send to Author
      await this.mailService.sendMail({
        to: user.email,
        bcc: 'scspace.kaist@gmail.com',
        subject: '[SCSpace] 근로장학생 배정 안내',
        context: metaAuthor,
        template: 'worker',
      });

      //Send to Worker
      await this.mailService.sendMail({
        to: worker.email,
        bcc: 'scspace.kaist@gmail.com',
        subject: '[SCSpace] 근로 할당 확정 안내',
        context: metaWorker,
        template: 'worker',
      });
    } catch (error) {
      Logger.error(error);
      await this.mailService.reportError(
        error instanceof Error ? error : new Error(String(error)),
        'Worker - Mail Sector',
      );
    }

    return MReservation.fromDB(reservationUpdated, reservationContentUpdated);
  }

  async updateReservationApproval(
    approval: IReservationApprovalRequest,
  ): Promise<MReservation> {
    if (
      approval.state !== ReservationStateEnum.GRANT &&
      approval.state !== ReservationStateEnum.REJECTED
    ) {
      throw new BadRequestException(
        'Reservation approval must be GRANT or REJECTED',
      );
    }

    const { data: reservations } = await this.reservationRepository.fetch({
      id: approval.id,
    });
    if (reservations.length === 0) {
      throw new NotFoundException('Reservation not found');
    }

    const reservation = reservations[0];
    if (reservation.state !== ReservationStateEnum.WAIT) {
      throw new BadRequestException(
        'Only waiting reservations can be approved or rejected',
      );
    }

    const space = await this.spacePublicService.fetchById(reservation.spaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    if (
      space.spaceType !== SpaceTypeEnum.MIRAE &&
      space.spaceType !== SpaceTypeEnum.SUMI
    ) {
      throw new BadRequestException(
        'Only Mirae Hall and Sumi Jo Hall reservations require approval',
      );
    }

    if (approval.state === ReservationStateEnum.GRANT) {
      await this.reservationPublicService.validateApprovalConstraints(
        reservation.userId,
        reservation.organizationId,
        space,
        reservation.timeFrom,
        reservation.timeTo,
        reservation.id,
      );
    }

    const updated = await this.reservationRepository.updateApprovalState(
      reservation,
      approval.state,
    );
    const content = await this.reservationRepository.fetchContent(updated.id);
    if (!content) {
      throw new NotFoundException(
        'Reservation content not found after approval',
      );
    }

    try {
      const [user, organization] = await Promise.all([
        this.userPublicService.fetchById(updated.userId),
        this.organizationPublicService.fetchById(updated.organizationId),
      ]);
      if (!user || !organization) {
        throw new Error('Reservation mail recipient not found');
      }

      const organizationWithMembers =
        organization.id !== 1
          ? await this.organizationPublicService.fetchDeepById(organization.id)
          : undefined;
      if (!organizationWithMembers && organization.id !== 1) {
        throw new Error('Organization fetch error');
      }

      const approved = approval.state === ReservationStateEnum.GRANT;
      const timeFrom = getString(updated.timeFrom);
      const timeTo = getString(updated.timeTo);
      const templateFooter =
        organization.id === 1
          ? '문의사항이 있으시면 언제든 연락해 주세요.'
          : '이 메일은 예약자 본인 및 조직에 등록된 모든 구성원에게 발송되었습니다.';
      const templateFooterEn =
        organization.id === 1
          ? 'Please feel free to contact us if you have any questions.'
          : 'This email has been sent to the reservation holder and all members registered with the organization.';
      const meta = {
        ...(approved
          ? ReservationMeta.ReservationApproved
          : ReservationMeta.ReservationRejected),
        timeFrom,
        timeTo,
        templateFooter,
        templateFooterEn,
      };

      await this.mailService.sendMail({
        to:
          organization.id === 1
            ? user.email
            : organizationWithMembers.members.map(
                (member) => member.user.email,
              ),
        subject: approved
          ? `[SCSpace] Reservation Approved - ${updated.title}`
          : `[SCSpace] Reservation Rejected - ${updated.title}`,
        template: 'reservationPosted',
        replyTo: 'scspace@kaist.ac.kr',
        context: {
          reservation: {
            ...updated,
            user,
            space,
            organization,
            workerNeed: content.workerNeed,
          },
          meta,
        },
      });
    } catch (error) {
      Logger.error(error);
      await this.reportMailError(
        error,
        'Update Reservation Approval - Mail Sector',
      );
    }

    if (approval.state === ReservationStateEnum.GRANT && content.workerNeed) {
      try {
        const [user, organization, workers] = await Promise.all([
          this.userPublicService.fetchById(updated.userId),
          this.organizationPublicService.fetchById(updated.organizationId),
          this.userPublicService.fetchAllWorker(),
        ]);
        if (!user || !organization) {
          throw new Error('Worker notification reservation data not found');
        }

        await this.mailService.sendMail({
          to: workers.map((worker) => worker.email),
          subject: '[SCSpace] New Work-Request Reservation Created',
          cc: 'scspace.kaist@gmail.com',
          bcc: 'jhlee012@kaist.ac.kr',
          template: 'reservationPosted',
          replyTo: 'scspace@kaist.ac.kr',
          context: {
            reservation: {
              ...updated,
              user,
              space,
              organization,
              workerNeed: true,
            },
            workerMail: true,
            meta: {
              ...ReservationMeta.WorkerNotif,
              timeFrom: getString(updated.timeFrom),
              timeTo: getString(updated.timeTo),
            },
          },
        });
      } catch (error) {
        Logger.error(error);
        await this.reportMailError(
          error,
          'Approved Worker Request - Mail Sector',
        );
      }
    }

    return MReservation.fromDB(updated, content);
  }

  async updateReservation(
    reservationInput: Omit<IReservationUpdate, 'workerId'>,
    actor: IUser,
  ): Promise<MReservation> {
    const { data: reservation } = await this.reservationRepository.fetch({
      id: reservationInput.id,
    });

    if (reservation.length === 0) {
      throw new NotFoundException('Reservation not found');
    }

    const timeFrom = reservationInput.timeFrom ?? reservation[0].timeFrom;
    const timeTo = reservationInput.timeTo ?? reservation[0].timeTo;
    const safeReservationInput: IReservationUpdate = {
      id: reservationInput.id,
      title: reservationInput.title,
      timeFrom,
      timeTo,
      content: reservationInput.content
        ? {
            description: reservationInput.content.description,
            innerParticipantNumber:
              reservationInput.content.innerParticipantNumber,
            outerParticipantNumber:
              reservationInput.content.outerParticipantNumber,
            food: reservationInput.content.food,
            busking: reservationInput.content.busking,
            workerNeed: reservationInput.content.workerNeed,
            workerNeedReason: reservationInput.content.workerNeedReason,
          }
        : undefined,
    };

    await this.reservationPublicService.checkWholeTime(
      reservation[0].userId,
      reservation[0].organizationId,
      reservation[0].spaceId,
      timeFrom,
      timeTo,
      reservationInput.id,
    );

    const [user, space, organization] = await Promise.all([
      this.userPublicService.fetchById(reservation[0].userId),
      this.spacePublicService.fetchById(reservation[0].spaceId),
      this.organizationPublicService.fetchById(reservation[0].organizationId),
    ]);

    if (!user) throw new BadRequestException('User not found');
    if (!organization) throw new BadRequestException('Organization not found');
    if (!space) throw new BadRequestException('Space not found');

    await this.reservationPublicService.validateSpaceTimeConstraints(
      reservation[0].userId,
      reservation[0].organizationId,
      space,
      timeFrom,
      timeTo,
      reservationInput.id,
    );
    // 공간 정보 조회하여 세미나실 추첨 기간 겹침 검증
    await this.reservationPublicService.validateSeminarLotteryConflict(
      reservation[0].userId,
      space,
      timeFrom,
      timeTo,
    );

    await this.reservationPublicService.validatePerformanceLotteryConflict(
      reservation[0].userId,
      space,
      timeFrom,
      timeTo,
    );

    const timeChanged =
      timeFrom !== reservation[0].timeFrom || timeTo !== reservation[0].timeTo;
    const returnToWait =
      timeChanged &&
      !UserUtils.isManager(actor.type) &&
      reservation[0].state === ReservationStateEnum.GRANT &&
      (space.spaceType === SpaceTypeEnum.MIRAE ||
        space.spaceType === SpaceTypeEnum.SUMI);

    const [reservationUpdated, reservationContentUpdated] =
      await this.reservationRepository.update(
        safeReservationInput,
        returnToWait ? ReservationStateEnum.WAIT : undefined,
        reservation[0],
      );

    //Mail 관련은 작동하지 않아도 상관없도록 try-catch with await
    try {
      const timeFrom = getString(reservationUpdated.timeFrom);
      const timeTo = getString(reservationUpdated.timeTo);
      const workerNeed: boolean = reservationContentUpdated.workerNeed;
      const templateFooter: string =
        organization.id === 1
          ? '문의사항이 있으시면 언제든 연락해 주세요.'
          : '이 메일은 예약자 본인 및 조직에 등록된 모든 구성원에게 발송되었습니다.';
      const templateFooterEn: string =
        organization.id === 1
          ? 'Please feel free to contact us if you have any questions.'
          : 'This email has been sent to the reservation holder and all members registered with the organization.';
      const meta = {
        ...ReservationMeta.ReservationUpdated,
        timeFrom,
        timeTo,
        templateFooter,
        templateFooterEn,
      };

      const organizationWithMembers =
        organization.id !== 1
          ? await this.organizationPublicService.fetchDeepById(organization.id)
          : undefined;

      await this.mailService.sendMail({
        to:
          organization.id === 1
            ? user.email
            : organizationWithMembers.members.map(
                (member) => member.user.email,
              ),
        subject: `[SCSpace] Reservation Updated - ${reservation[0].title}`,
        // bcc: 'scspace.kaist@gmail.com',
        template: 'reservationPosted',
        replyTo: 'scspace@kaist.ac.kr',
        context: {
          reservation: {
            ...reservation[0],
            user,
            space,
            organization,
            workerNeed,
          },
          meta,
        },
      });
    } catch (error) {
      Logger.error(error);
      await this.mailService.reportError(
        error instanceof Error ? error : new Error(String(error)),
        'Update Reservation - Mail Sector',
      );
    }

    return MReservation.fromDB(reservationUpdated, reservationContentUpdated);
  }

  async deleteReservation(id: number, user: IUser): Promise<ISuccessResponse> {
    const { data: reservation } = await this.reservationRepository.fetch({
      id: id,
    });
    if (reservation.length === 0) {
      throw new NotFoundException('Reservation not found');
    }
    // individual
    if (reservation[0].organizationId === 1) {
      if (
        reservation[0].userId !== user.id &&
        !UserUtils.isManager(user.type)
      ) {
        throw new BadRequestException(
          'User does not have permission to delete this reservation',
        );
      }
    }
    const [space, organization] = await Promise.all([
      this.spacePublicService.fetchById(reservation[0].spaceId),
      this.organizationPublicService.fetchById(reservation[0].organizationId),
    ]);
    const result = await this.reservationRepository.delete(id);
    if (!result) {
      throw new NotFoundException('Reservation not found');
    }

    //Mail관련은 전부 try-catch with await for Error Control
    try {
      const timeFrom = getString(reservation[0].timeFrom);
      const timeTo = getString(reservation[0].timeTo);
      const workerNeed: boolean = false;

      //조직의 경우 모든 구성원에게 발송함 Notif
      const templateFooter: string =
        organization.id === 1
          ? '문의사항이 있으시면 언제든 연락해 주세요.'
          : '이 메일은 예약자 본인 및 조직에 등록된 모든 구성원에게 발송되었습니다.';
      const templateFooterEn: string =
        organization.id === 1
          ? 'Please feel free to contact us if you have any questions.'
          : 'This email has been sent to the reservation holder and all members registered with the organization.';
      const meta = {
        ...ReservationMeta.ReservationDeleted,
        timeFrom,
        timeTo,
        templateFooter,
        templateFooterEn,
      };

      const organizationWithMembers =
        organization.id !== 1
          ? await this.organizationPublicService.fetchDeepById(organization.id)
          : undefined;

      await this.mailService.sendMail({
        to:
          organization.id === 1
            ? user.email
            : organizationWithMembers.members.map(
                (member) => member.user.email,
              ),
        subject: `[SCSpace] Reservation Deleted - ${reservation[0].title}`,
        // bcc: 'scspace.kaist@gmail.com',
        template: 'reservationPosted',
        replyTo: 'scspace@kaist.ac.kr',
        context: {
          reservation: {
            ...reservation[0],
            user,
            space,
            organization,
            workerNeed,
          },
          meta,
        },
      });
    } catch (error) {
      Logger.error(error);
      await this.mailService.reportError(
        error instanceof Error ? error : new Error(String(error)),
        'Delete Reservation - Mail Sector',
      );
    }
    return {
      success: true,
    };
  }

  async getManageReservation(): Promise<IReservationAll[]> {
    const { data: reservations } = await this.reservationRepository.fetch({
      state: ReservationStateEnum.WAIT,
    });

    const userIds = reservations.map((reservation) => reservation.userId);
    const organizationIds = reservations.map(
      (reservation) => reservation.organizationId,
    );
    const spaceIds = reservations.map((reservation) => reservation.spaceId);

    const [users, organizations, spaces, reservationContents] =
      (await Promise.all([
        this.userPublicService
          .fetchAllByIds(userIds)
          .then(takeAll(userIds, 'users')),
        this.organizationPublicService.fetchByIds(organizationIds),
        this.spacePublicService.fetchAllByIds(spaceIds),
        this.reservationPublicService.getReservationContentByIds(
          reservations.map((reservation) => reservation.id),
        ),
      ])) as [IUser[], IOrganization[], ISpace[], IReservationContent[]];

    const workerIds = reservationContents
      .map((content) => content.workerId)
      .filter((id) => id !== 0);
    const workers = await this.userPublicService
      .fetchAllByIds(workerIds)
      .then(takeAll(workerIds, 'workers'));

    checkContainAllId(userIds, users, 'users');
    checkContainAllId(organizationIds, organizations, 'organizations');
    checkContainAllId(spaceIds, spaces, 'spaces');
    checkContainAllId(workerIds, workers, 'workers');

    return reservations
      .map((reservation) => {
        const content = reservationContents.find(
          (content) => content.id === reservation.id,
        )!;
        return {
          ...reservation,
          user: users.find((user) => user.id === reservation.userId)!,
          organization: organizations.find(
            (org) => org.id === reservation.organizationId,
          )!,
          space: spaces.find((space) => space.id === reservation.spaceId)!,
          content,
          worker:
            content.workerId === 0
              ? null
              : workers.find((worker) => worker.id === content.workerId)!,
        };
      })
      .filter(
        (reservation) =>
          reservation.space.spaceType === SpaceTypeEnum.MIRAE ||
          reservation.space.spaceType === SpaceTypeEnum.SUMI,
      );
  }
}
