import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateRoleDTO } from './dto/create-role.dto';
import { UpdateRoleDTO } from './dto/update-role.dto';
import { RoleRepository } from './repository/role.repository';

@Injectable()
export class RoleService {
  constructor(private readonly roleRepository: RoleRepository) {}
  async create(createRole: CreateRoleDTO, user) {
    try {
      const role = await this.roleRepository.create({
        userId: user.userId,
        ...createRole,
      });
      return role;
    } catch (error) {
      if (error.message.includes('duplicate key')) {
        throw new BadRequestException(['Role alreay exists']);
      }
    }
  }

  async findAll(user) {
    return this.roleRepository.find({
      userId: user.userId,
    });
  }

  findOne(id: string, user) {
    return this.roleRepository.findOne({ _id: id, userId: user.userId });
  }

  update(id: string, updateRole: UpdateRoleDTO, user) {
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
    return this.roleRepository.findOneAndDelete({
      _id: id,
      userId: user.userId,
    });
  }
}
