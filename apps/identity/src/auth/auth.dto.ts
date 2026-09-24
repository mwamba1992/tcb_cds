import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { STEP_UP_REQUIRED } from '@govsec/auth';

// Phone numbers are shape-checked loosely here and normalised by the service, which
// accepts 0712…, 255712… and +255712… alike.
const PHONE = /^[+\d][\d\s\-().]{8,19}$/;
const PIN = /^\d{4}$/;

export class StartRegistrationDto {
  @ApiProperty({ example: '0712345678' })
  @Matches(PHONE, { message: 'phoneNumber must be a phone number' })
  phoneNumber!: string;

  @ApiPropertyOptional({ enum: ['sw', 'en'], default: 'sw' })
  @IsOptional()
  @IsIn(['sw', 'en'])
  locale?: 'sw' | 'en';
}

export class CompleteRegistrationDto extends StartRegistrationDto {
  @ApiProperty({ example: '123456', description: 'Six-digit code from SMS' })
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;
}

export class SignInDto {
  @ApiProperty({ example: '0712345678' })
  @Matches(PHONE, { message: 'phoneNumber must be a phone number' })
  phoneNumber!: string;

  @ApiProperty({ example: '4827' })
  @IsString()
  @Length(1, 12)
  pin!: string;
}

export class SetPinDto {
  @ApiProperty({ example: '4827', description: 'Four digits; no runs, repeats or common PINs' })
  @Matches(PIN, { message: 'pin must be four digits' })
  pin!: string;
}

export class ChangePinDto {
  @ApiProperty()
  @Matches(PIN, { message: 'currentPin must be four digits' })
  currentPin!: string;

  @ApiProperty()
  @Matches(PIN, { message: 'newPin must be four digits' })
  newPin!: string;
}

export class StartPinResetDto {
  @ApiProperty({ example: '0712345678' })
  @Matches(PHONE, { message: 'phoneNumber must be a phone number' })
  phoneNumber!: string;
}

export class CompletePinResetDto extends StartPinResetDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;

  @ApiProperty({ example: '4827' })
  @Matches(PIN, { message: 'newPin must be four digits' })
  newPin!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(1, 4096)
  refreshToken!: string;
}

export class LocaleDto {
  @ApiProperty({ enum: ['sw', 'en'] })
  @IsIn(['sw', 'en'])
  locale!: 'sw' | 'en';
}

export class StepUpDto {
  @ApiProperty()
  @Matches(PIN, { message: 'pin must be four digits' })
  pin!: string;

  @ApiProperty({ enum: STEP_UP_REQUIRED, example: 'bid:place' })
  @IsIn([...STEP_UP_REQUIRED])
  scope!: string;

  @ApiPropertyOptional({ example: '5000000.00', description: 'TZS ceiling, as a decimal string' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,15}(\.\d{1,2})?$/, { message: 'amount must be a decimal string like 5000000.00' })
  amount?: string;
}

export class StaffSignInDto {
  @ApiProperty({ example: 'rose.mollel' })
  @IsString()
  @Length(2, 60)
  username!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  password!: string;
}

export class StaffStepUpDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  password!: string;

  @ApiProperty({ enum: STEP_UP_REQUIRED, example: 'batch:approve' })
  @IsIn([...STEP_UP_REQUIRED])
  scope!: string;
}
