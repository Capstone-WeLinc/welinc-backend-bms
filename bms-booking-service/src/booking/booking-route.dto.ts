import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class BookingRouteDto {
  @IsString() @IsNotEmpty() @MaxLength(500) pickupAddress!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) deliveryAddress!: string;
  @IsOptional() @IsString() @MaxLength(500) pickupLandmark?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryLandmark?: string;
}
