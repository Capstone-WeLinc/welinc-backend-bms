import { ArrayMaxSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** One list of details for an additional service (spec bms/0013): at most 20 lines of 200 characters. */
const DetailList = (): PropertyDecorator => (target, key) => {
  IsOptional()(target, key);
  IsArray()(target, key);
  ArrayMaxSize(20)(target, key);
  IsString({ each: true })(target, key);
  MaxLength(200, { each: true })(target, key);
};

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
  @DetailList() inclusions?: string[];
  @DetailList() paymentOptions?: string[];
  @DetailList() exclusions?: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) cashCharge?: number;
}

export class UpdateServiceOfferingDto extends UpdatePrimaryServiceDto {
  @IsOptional() @IsString() @MaxLength(50) duration?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
  @DetailList() inclusions?: string[];
  @DetailList() paymentOptions?: string[];
  @DetailList() exclusions?: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) cashCharge?: number;
}

export class CreateProtectiveMaterialDto extends CreatePrimaryServiceDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price!: number;
}

export class UpdateProtectiveMaterialDto extends UpdatePrimaryServiceDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
}
