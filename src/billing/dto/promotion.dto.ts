import { IsNotEmpty, IsString } from 'class-validator';

export class PromotionAppDto {
  @IsString() @IsNotEmpty() appId: string;
}
