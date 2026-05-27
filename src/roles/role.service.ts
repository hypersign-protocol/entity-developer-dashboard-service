import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreateRoleDTO } from './dto/create-role.dto';
import { UpdateRoleDTO } from './dto/update-role.dto';
import { RoleRepository } from './repository/role.repository';

@Injectable()
export class RoleService {
  constructor(private readonly roleRepository: RoleRepository) {}
  async create(createRole: CreateRoleDTO, user) {
    try {
      Logger.log('Inside create() function to create new role', 'RoleService');
      const role = await this.roleRepository.create({
        userId: user.userId,
        ...createRole,
      });
      return role;
    } catch (error: any) {
      if (error.message.includes('duplicate key')) {
        throw new BadRequestException(['Role already exists.']);
      }
      throw error;
    }
  }

  async findAll(user) {
    Logger.log('Inside findAll() function to fetch roles', 'RoleService');
    return this.roleRepository.find({
      userId: user.userId,
    });
  }

  findOne(id: string, user) {
    Logger.log(
      'Inside findOne() method to fetch particular role',
      'RoleService',
    );
    return this.roleRepository.findOne({ _id: id, userId: user.userId });
  }

  update(id: string, updateRole: UpdateRoleDTO, user) {
    Logger.log(
      'Inside update() method to update particular role',
      'RoleService',
    );

    return this.roleRepository.findOneAndUpdate(
      {
        _id: id,
        userId: user.userId,
      },
      {
        ...updateRole,
      },
    );
  }

  remove(id: string, user) {
    Logger.log('Inside remove() to delete role', 'RoleService');
    return this.roleRepository.findOneAndDelete({
      _id: id,
      userId: user.userId,
    });
  }
}
