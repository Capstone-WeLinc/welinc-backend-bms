import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreatePrimaryServiceDto {
  @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdatePrimaryServiceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateServiceOfferingDto extends CreatePrimaryServiceDto {
  @IsOptional() @IsString() @MaxLength(50) duration?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price!: number;
}

export class UpdateServiceOfferingDto extends UpdatePrimaryServiceDto {
  @IsOptional() @IsString() @MaxLength(50) duration?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
}

export class CreateProtectiveMaterialDto extends CreatePrimaryServiceDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price!: number;
}

export class UpdateProtectiveMaterialDto extends UpdatePrimaryServiceDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
}
