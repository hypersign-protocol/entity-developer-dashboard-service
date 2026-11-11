import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ description: 'From POST /billing/quotes' })
  @IsMongoId()
  quoteId: string;
}

// What the checkout handed the browser (Razorpay: razorpay_order_id,
// razorpay_payment_id, razorpay_signature).
export class ConfirmOrderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  providerOrderId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  paymentId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  signature: string;
}
