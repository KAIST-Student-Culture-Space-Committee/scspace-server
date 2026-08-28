jest.mock(
  '@scspace-depot/enums/organization.enum',
  () => ({
    OrganizationStatusEnum: {
      VERIFY_REQUEST: 3,
      REJECTED: 0,
      VERIFIED: 1,
    },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({ UserUtils: { isManager: (type: number) => type === 2 } }),
  { virtual: true },
);
jest.mock('./organization.service', () => ({ OrganizationService: class {} }));
jest.mock('./organization.public.service', () => ({
  OrganizationPublicService: class {},
}));
jest.mock('../auth/jwt/jwt.guard', () => ({
  ManagerGuard: class {},
  UserGuard: class {},
  MemberGuard: class {},
  DelegatorGuard: class {},
}));

import { OrganizationStatusEnum } from '@scspace-depot/enums/organization.enum';
import { OrganizationController } from './organization.controller';

describe('OrganizationController', () => {
  const organizationService = {
    insert: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    updateDelegator: jest.fn(),
    delete: jest.fn(),
    deleteMember: jest.fn(),
  };
  const organizationPublicService = {
    fetchAll: jest.fn(),
    fetchVerified: jest.fn(),
    fetchByUserId: jest.fn(),
    fetchDeepById: jest.fn(),
    insertMember: jest.fn(),
  };

  function controller(): OrganizationController {
    return new OrganizationController(
      organizationService as never,
      organizationPublicService as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    organizationService.updateStatus.mockResolvedValue({
      id: 10,
      status: OrganizationStatusEnum.VERIFIED,
    });
    organizationPublicService.fetchAll.mockResolvedValue([]);
  });

  it('filters out organization id 1 in personal organization list', async () => {
    const mine = [
      { id: 1, name: 'hidden' },
      { id: 2, name: 'team-b' },
    ];
    organizationPublicService.fetchByUserId.mockResolvedValue(mine);

    await expect(controller().getOrganizationsByUserId(9)).resolves.toEqual([
      { id: 2, name: 'team-b' },
    ]);
    expect(organizationPublicService.fetchByUserId).toHaveBeenCalledWith(9);
  });

  it('delegator status change uses VERIFY_REQUEST enum', async () => {
    await controller().requestVerifyOrganization(3);

    expect(organizationService.updateStatus).toHaveBeenCalledWith(
      3,
      OrganizationStatusEnum.VERIFY_REQUEST,
    );
  });

  it('update status accepts provided status payload', async () => {
    await controller().updateOrganizationStatus(8, {
      status: OrganizationStatusEnum.REJECTED,
    } as never);

    expect(organizationService.updateStatus).toHaveBeenCalledWith(
      8,
      OrganizationStatusEnum.REJECTED,
    );
  });

  it('add member delegates to organization public service', async () => {
    await controller().addMember(12, { userId: 100 } as never);

    expect(organizationPublicService.insertMember).toHaveBeenCalledWith(
      12,
      100,
    );
  });

  it('remove member delegates organization member deletion', async () => {
    await controller().removeMember(12, { userId: 100 } as never);

    expect(organizationService.deleteMember).toHaveBeenCalledWith(12, 100);
  });

  it('forwards create organization payload to service with request user', async () => {
    organizationService.insert.mockResolvedValue({ id: 10, name: 'new-org' });
    const body = { name: 'new-org' } as never;
    const req = { user: { id: 5, type: 1, nameKr: 'User' } } as {
      user: { id: number; type: number; nameKr: string };
    };

    await expect(
      controller().createOrganization(body, req as never),
    ).resolves.toEqual({
      id: 10,
      name: 'new-org',
    });
    expect(organizationService.insert).toHaveBeenCalledWith(body, req.user);
  });

  it('forwards update payload with organization id', async () => {
    await controller().updateOrganization(12, { name: 'renamed' } as never);

    expect(organizationService.update).toHaveBeenCalledWith(12, {
      name: 'renamed',
    });
  });

  it('forwards delegator change payload to service', async () => {
    organizationService.updateDelegator.mockResolvedValue({
      id: 12,
      delegatorId: 77,
    });
    await controller().updateOrganizationDelegator(12, {
      delegatorId: 77,
    } as never);

    expect(organizationService.updateDelegator).toHaveBeenCalledWith(12, 77);
  });

  it('forwards delete organization by id', async () => {
    organizationService.delete.mockResolvedValue({ success: true });

    await expect(controller().deleteOrganization(12)).resolves.toEqual({
      success: true,
    });
    expect(organizationService.delete).toHaveBeenCalledWith(12);
  });
});
