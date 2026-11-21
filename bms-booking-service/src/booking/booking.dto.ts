import { Type } from 'class-transformer';
import { Equals, IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

class AdditionalServiceDto {
  @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) price!: string;
}

class SelectedTruckDto {
  @IsString() @IsNotEmpty() @MaxLength(80) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) rate!: number;
  @IsString() @IsNotEmpty() @MaxLength(120) truckTypeId!: string;
  @IsString() @IsNotEmpty() @MaxLength(10) locationCode!: string;
}

export class CreateBookingDto {
  @IsString() @IsNotEmpty() @MaxLength(200) client!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) service!: string;
  @IsString() date!: string;
  @IsOptional() @IsString() @Matches(/^\d{1,8}(?:\.\d{1,2})?$/) amount?: string;
  @IsOptional() @IsString() @MaxLength(100) totalAmount?: string;
  // This is the customer's requested method, never settlement evidence.
  @IsOptional() @IsString() @MaxLength(100) paymentMethod?: string;
  @IsOptional() @Equals('Pending') paymentStatus?: 'Pending';
  @IsOptional() @Equals('For Plotting') status?: 'For Plotting';
  @IsOptional() @IsString() @MaxLength(100) serviceType?: string;
  @IsOptional() @IsString() @MaxLength(40) deliveryCategory?: string;
  @IsOptional() @ValidateNested() @Type(() => SelectedTruckDto) selectedTruck?: SelectedTruckDto;
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(100) preferredTime?: string;
  @IsOptional() @IsString() pickupAddress?: string;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) pickupLandmark?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryLandmark?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() deliveryLocation?: string;
  @IsOptional() @IsString() @MaxLength(100) contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() itemDetails?: string;
  @IsOptional() @IsString() specialInstructions?: string;
  @IsOptional() @IsInt() @Min(1) estimatedItems?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) servicesAvailed?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) protectiveMaterials?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AdditionalServiceDto) additionalServicesAvailed?: AdditionalServiceDto[];
  @IsOptional() @IsBoolean() hasInsurance?: boolean;
  @IsOptional() @IsBoolean() permitRequired?: boolean;
}

export class UpdateBookingDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(200) client?: string;
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(100) service?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() pickupAddress?: string;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsString() itemDetails?: string;
  @IsOptional() @IsString() specialInstructions?: string;
  @IsOptional() @IsBoolean() permitRequired?: boolean;
  @IsOptional() @IsString() discrepancyNote?: string;
  @IsOptional() @IsBoolean() flagged?: boolean;
  @IsOptional() @IsString() @MaxLength(100) contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() status?: string;
  /** Amount the client already paid before the trip. Null or an empty string clears it. */
  @IsOptional() @IsString() @Matches(/^(?:\d{1,8}(?:\.\d{1,2})?)?$/) downpayment?: string | null;
}
