import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrganizationRepository } from './organization.repository';
import { OrganizationMemberRepository } from './organization.member.repository';
import { IOrganization, IOrganizationCreate, IOrganizationUpdate } from '@scspace-depot/types/organization';
import { MOrganization } from './organization.model';
import { OrganizationPublicService } from './organization.public.service';
import { UserPublicService } from '../user/user.public.service';
import { ISuccessResponse } from '@scspace-depot/types/common';
import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';
import { MailService } from '@scspace-server/tools/mailer/mail.service';
import { getOrganizationStatusString } from '@scspace-server/common/utils';
import { OrgStatusMeta } from "@scspace-depot/enums/mail.enum";
import { IUser } from '@scspace-depot/types/user';
import { UserUtils } from '@scspace-depot/utils/user.utils';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    private readonly organizationPublicService: OrganizationPublicService,
    private readonly userPublicService: UserPublicService,
    private readonly mailService: MailService,
  ) { }

  async deleteMember(organizationId: number, userId: number): Promise<ISuccessResponse> {
    const organizationExist = await this.organizationPublicService.fetchById(organizationId);
    if (!organizationExist) {
      throw new NotFoundException('Organization not found');
    }
    const organizationMemberExist = await this.organizationMemberRepository.fetch({ organizationId, userId });
    if (organizationMemberExist.length === 0) {
      throw new NotFoundException('User not in organization');
    }
    await this.organizationMemberRepository.delete(organizationId, userId);
    return { success: true };
  }

  async insert(organization: IOrganizationCreate, actor: IUser): Promise<IOrganization> {
    if (!UserUtils.isManager(actor.type) && organization.delegatorId !== actor.id) {
      throw new ForbiddenException('Users can only create organizations for themselves');
    }

    const safeOrganization: IOrganizationCreate = {
      name: organization.name,
      hasRoom: organization.hasRoom,
      delegatorId: UserUtils.isManager(actor.type) ? organization.delegatorId : actor.id,
      description: organization.description,
    };
    const delegator = await this.userPublicService.fetchById(safeOrganization.delegatorId);
    if (!delegator) {
      throw new NotFoundException('Delegator not found');
    }
    const newOrganization = await this.organizationRepository.insert(safeOrganization);
    await this.organizationMemberRepository.insert(newOrganization.id, safeOrganization.delegatorId);

    const statusString = getOrganizationStatusString(newOrganization.status);

    const meta = OrgStatusMeta[newOrganization.status];

    void this.mailService.sendMail({
      to: delegator.email,
      bcc: "scspace.kaist@gmail.com",
      subject: `[SCSpace] Organization Created - ${safeOrganization.name}`,
      template: "orgStatusUpdate",
      context: {
        organization: {
          ...safeOrganization,
          status: statusString
        },
        meta
      }
    }).catch((error) => Logger.error('Failed to send organization creation mail', error));

    if (safeOrganization.description) {
      void this.mailService.sendMail({
        to: 'scspace.kaist@gmail.com',
        subject: `신규 등록 조직 소명: ${safeOrganization.name}`,
        template: 'orgDescription',
        context: {
          meta: {
            organizationName: safeOrganization.name,
            organizationDescription: safeOrganization.description,
          },
        },
      }).catch((error) => Logger.error('Failed to send organization description mail', error));
    }

    return MOrganization.fromDB(newOrganization);
  }

  async update(organizationId: number, organizationNew: IOrganizationUpdate): Promise<IOrganization> {
    const organization: IOrganization = await this.organizationPublicService.fetchById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    if (organizationNew.delegatorId) {
      const delegator = await this.userPublicService.fetchById(organizationNew.delegatorId);
      if (!delegator) {
        throw new NotFoundException('Delegator not found');
      }
    }

    const updatedOrganization = await this.organizationRepository.update(
      organizationId,
      organizationNew
    );

    return MOrganization.fromDB(updatedOrganization);
  }

  async updateDelegator(organizationId: number, newDelegatorId: number): Promise<IOrganization> {
    const organization: IOrganization = await this.organizationPublicService.fetchById(organizationId);

    const updatedOrganization = await this.organizationRepository.update(
      organizationId,
      { delegatorId: newDelegatorId }
    );

    const oldDelegator = await this.userPublicService.fetchById(organization.delegatorId);
    const newDelegator = await this.userPublicService.fetchById(newDelegatorId);

    this.mailService.sendMail({
      to: [oldDelegator.email, newDelegator.email],
      template: "orgDelegatorUpdate",
      subject: `[SCSpace] Organization Delegator Updated - ${updatedOrganization.name}`,
      context: {
        organization: {
          ...organization,
          delegator: oldDelegator,
        },
        user: newDelegator
      }
    });

    return MOrganization.fromDB(updatedOrganization);
  }

  async updateStatus(organizationId: number, status: OrganizationStatusEnum): Promise<IOrganization> {
    const organization: IOrganization = await this.organizationPublicService.fetchById(organizationId);
    const delegator = await this.userPublicService.fetchById(organization.delegatorId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const updatedOrganization = await this.organizationRepository.update(
      organizationId,
      { status }
    );

    const statusString = getOrganizationStatusString(status);

    const meta = OrgStatusMeta[status];

    this.mailService.sendMail({
      to: delegator.email,
      bcc: "scspace.kaist@gmail.com",
      subject: `[SCSpace] Organization Authority Updated - ${organization.name}`,
      template: "orgStatusUpdate",
      context: {
        organization: {
          ...organization,
          status: statusString
        },
        meta
      }
    })

    return MOrganization.fromDB(updatedOrganization);
  }

  async delete(organizationId: number): Promise<ISuccessResponse> {
    const organization = await this.organizationPublicService.fetchById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    await this.organizationRepository.delete(organizationId);

    return { success: true };
  }
}
