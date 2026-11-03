import { RoleService } from './role.service';

describe('RoleService create', () => {
  const roleRepository = { create: jest.fn() };
  const onboardingRepository = { findOrgIdByOwner: jest.fn() };
  let service: RoleService;

  beforeEach(() => {
    jest.clearAllMocks();
    roleRepository.create.mockImplementation(async (role) => role);
    service = new RoleService(
      roleRepository as any,
      onboardingRepository as any,
    );
  });

  it("stores the owner's organisation on the role", async () => {
    onboardingRepository.findOrgIdByOwner.mockResolvedValue('org-1');

    await service.create({ roleName: 'Viewer', permissions: [] } as any, {
      userId: 'owner-1',
    });

    expect(onboardingRepository.findOrgIdByOwner).toHaveBeenCalledWith(
      'owner-1',
    );
    expect(roleRepository.create).toHaveBeenCalledWith({
      roleName: 'Viewer',
      permissions: [],
      userId: 'owner-1',
      orgId: 'org-1',
    });
  });

  it('does not let the request body choose the owner', async () => {
    onboardingRepository.findOrgIdByOwner.mockResolvedValue(undefined);

    await service.create(
      { roleName: 'Viewer', permissions: [], userId: 'someone-else' } as any,
      { userId: 'owner-1' },
    );

    expect(roleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', orgId: undefined }),
    );
  });
});
