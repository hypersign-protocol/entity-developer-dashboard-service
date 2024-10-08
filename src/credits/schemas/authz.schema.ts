import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsNotEmpty, IsString } from 'class-validator';

export enum scope {
  MsgRegisterDID = 'MsgRegisterDID',
  MsgUpdateDID = 'MsgUpdateDID',
  MsgDeactivateDID = 'MsgDeactivateDID',
  MsgRegisterCredentialSchema = 'MsgRegisterCredentialSchema',
  MsgRegisterCredentialStatus = 'MsgRegisterCredentialStatus',
  MsgUpdateCredentialStatus = 'MsgUpdateCredentialStatus',
}

export type AuthZCreditsDocument = AuthZCredits & Document;

@Schema()
class Amount {
  @Prop({
    type: String,
  })
  denom: string;

  @Prop({
    type: String,
  })
  amount: string;
}

@Schema({ timestamps: true })
export class AuthZCredits {
  @IsNotEmpty()
  @IsString()
  @Prop({
    required: true,
  })
  userId: string;

  @IsNotEmpty()
  @IsString()
  @Prop({
    required: true,
  })
  appId: string;

  @Prop({
    type: Date,
  })
  expires: string;

  @Prop({
    type: Amount,
  })
  credit: Amount;
  @Prop({
    type: [String],
    enum: scope,
  })
  creditScope: Array<scope>;
}

export const AuthZCreditsSchema = SchemaFactory.createForClass(AuthZCredits);
