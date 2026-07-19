import { IsOptional, IsString, IsArray, ArrayNotEmpty, ArrayUnique, IsUUID, IsIn } from 'class-validator';

export class AssignSchedulingDto {
  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsString()
  garage?: string;

  @IsOptional()
  @IsString()
  @IsIn(['Inhouse', 'Subcon'])
  deliveryType?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  helperIds?: string[];
}
