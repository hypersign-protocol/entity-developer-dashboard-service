import { Optional } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AuthneticatorType } from 'src/social-login/dto/response.dto';
import {
  SERVICES,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';

export interface UserAccess {
  serviceType: SERVICE_TYPES;
  access: SERVICES.CAVACH_API.ACCESS_TYPES | SERVICES.SSI_API.ACCESS_TYPES;
  expiryDate: Date;
}

export enum UserRole {
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export type UserDocument = User & Document;
class Authenticator {
  @Prop({ required: true, enum: AuthneticatorType })
  type: string;
  @Prop({ required: true })
  secret: string;
  @Prop({ required: false })
  isTwoFactorAuthenticated?: string;
}
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  userId: string;
  @Prop({ required: true, unique: true })
  email: string;
  @Prop({ required: false }) // as we won't get did in google login
  did?: string;
  @Prop({ required: false })
  name?: string;
  @Prop({ required: false })
  profileIcon?: string;
  @Prop({ required: false })
  @Optional()
  accessList: Array<UserAccess>;
  @Prop({ default: [] })
  authenticators?: Authenticator[];
  @Prop({
    required: false,
    type: String,
    enum: UserRole,
    default: UserRole.ADMIN,
  })
  role?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
