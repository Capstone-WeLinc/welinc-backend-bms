import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateBookingDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  moveDate?: string;

  @IsOptional()
  @IsString()
  discrepancyNote?: string;

  @IsOptional()
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @IsBoolean()
  permitRequired?: boolean;
}
