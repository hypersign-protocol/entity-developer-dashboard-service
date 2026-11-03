import { BadRequestException } from '@nestjs/common';
import { PeopleService } from './people.service';

jest.mock('src/utils/redis.provider', () => ({ redisClient: {} }));

describe('PeopleService createInvitation', () => {
  const userRepository = { findOne: jest.fn() };
  const adminPeopleRepository = { findOne: jest.fn(), create: jest.fn() };
  const roleRepository = {
    findOne: jest.fn(),
    findUsingAggregation: jest.fn(),
  };
  const mailService = { addJobToMailQueue: jest.fn() };
  const config = { get: jest.fn() };
  const onboardingRepository = { findOrgIdByOwner: jest.fn() };
  const owner = { userId: 'owner-1', email: 'owner@acme.test' };
  let service: PeopleService;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue({ userId: 'member-1' });
    adminPeopleRepository.findOne.mockResolvedValue(null);
    adminPeopleRepository.create.mockResolvedValue({});
    onboardingRepository.findOrgIdByOwner.mockResolvedValue('org-1');
    service = new PeopleService(
      userRepository as any,
      adminPeopleRepository as any,
      roleRepository as any,
      {} as any,
      {} as any,
      config as any,
      mailService as any,
      onboardingRepository as any,
    );
  });

  it("looks up the role only among the inviting owner's roles", async () => {
    roleRepository.findOne.mockResolvedValue({
      _id: 'role-1',
      roleName: 'Viewer',
    });

    await service.createInvitation(
      { emailId: 'member@acme.test', roleId: 'role-1' } as any,
      owner,
    );

    expect(roleRepository.findOne).toHaveBeenCalledWith({
      _id: 'role-1',
      userId: 'owner-1',
    });
    expect(adminPeopleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'owner-1',
        orgId: 'org-1',
        roleId: 'role-1',
        roleName: 'Viewer',
      }),
    );
  });

  it("rejects another owner's role", async () => {
    roleRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createInvitation(
        { emailId: 'member@acme.test', roleId: 'someone-elses-role' } as any,
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(adminPeopleRepository.create).not.toHaveBeenCalled();
  });
});
