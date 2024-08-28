import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type AdminPeopleDocument = AdminPeople & Document;

@Schema({
  timestamps: true,
})
export class AdminPeople {
  @Prop({
    required: true,
  })
  adminId: string;
  @Prop({
    required: true,
  })
  userId: string;

  @Prop({ isRequired: true })
  inviteCode: string;

  @Prop({ isRequired: true })
  accepted: boolean;

  @Prop({
    type: Date,
    isRequired: false,
  })
  acceptedAt?: string;

  @Prop({
    type: Date,
  })
  invitationValidTill: string;
}

export const AdminPeopleSchema = SchemaFactory.createForClass(AdminPeople);

AdminPeopleSchema.index(
  {
    adminId: 1,
    userId: 1,
  },
  {
    unique: true,
  },
);
