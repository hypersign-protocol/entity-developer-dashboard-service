import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AccessList } from '../dto/create-role.dto';

export type RoleDocument = Role & Document;

@Schema({ timestamps: true })
export class Role {
  @Prop({ required: true })
  userId: string;
  // Organisation (CustomerOnboarding._id) the role belongs to.
  @Prop({ required: false })
  orgId?: string;
  @Prop({ required: true })
  roleName: string;

  @Prop({ required: false })
  roleDescription?: string;

  @Prop({
    required: true,
    type: Array<AccessList>,
  })
  permissions: Array<AccessList>;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
RoleSchema.index({ userId: 1, roleName: 1 }, { unique: true });
RoleSchema.index({ orgId: 1 });
