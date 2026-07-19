import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const BOOKING_ADDRESS_PATTERN = /^[\p{L}\p{N} .-]+$/u;
const BOOKING_MIN_ITEMS = 1;
const BOOKING_MAX_ITEMS = 500;
const BOOKING_ITEM_DETAILS_MAX_LENGTH = 500;
const BOOKING_SPECIAL_INSTRUCTIONS_MAX_LENGTH = 300;

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  client!: string;

  @IsString()
  @IsNotEmpty()
  service!: string;

  @IsString()
  @IsNotEmpty()
  date!: string;

  @IsString()
  @IsOptional()
  bookingId?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  serviceType?: string;

  @IsString()
  @IsOptional()
  deliveryCategory?: string;

  @IsString()
  @IsOptional()
  preferredTime?: string;

  @IsString()
  @IsOptional()
  @Matches(BOOKING_ADDRESS_PATTERN, {
    message: 'Pickup address may only contain letters, numbers, spaces, dash, and period.',
  })
  pickupAddress?: string;

  @IsString()
  @IsOptional()
  @Matches(BOOKING_ADDRESS_PATTERN, {
    message: 'Delivery address may only contain letters, numbers, spaces, dash, and period.',
  })
  deliveryAddress?: string;

  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsOptional()
  @IsString()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  deliveryLocation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(BOOKING_MIN_ITEMS)
  @Max(BOOKING_MAX_ITEMS)
  estimatedItems?: number;

  @IsOptional()
  @IsString()
  @MaxLength(BOOKING_ITEM_DETAILS_MAX_LENGTH)
  itemDetails?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BOOKING_SPECIAL_INSTRUCTIONS_MAX_LENGTH)
  specialInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BOOKING_SPECIAL_INSTRUCTIONS_MAX_LENGTH)
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  servicesAvailed?: string[];

  @IsOptional()
  @IsArray()
  protectiveMaterials?: string[];

  @IsOptional()
  @IsArray()
  additionalServicesAvailed?: { name: string; price: string }[];

  @IsOptional()
  @IsBoolean()
  hasInsurance?: boolean;

  @IsOptional()
  @IsBoolean()
  permitRequired?: boolean;
}
