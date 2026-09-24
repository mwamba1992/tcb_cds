import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export const SOURCES_OF_FUNDS = ['salary', 'business', 'savings', 'pension', 'inheritance', 'other'] as const;

const NAME = /^[\p{L}][\p{L}'’. -]{0,59}$/u;

export class IndividualProfileDto {
  @ApiProperty({ example: '19900521-13105-00001-37', description: '20 digits; separators allowed' })
  @Matches(/^[\d\s-]{20,26}$/, { message: 'nidaNumber must be the 20-digit NIDA number' })
  nidaNumber!: string;

  @ApiProperty({ example: 'Asha' })
  @Matches(NAME, { message: 'firstName must be a name' })
  firstName!: string;

  @ApiPropertyOptional({ example: 'Juma' })
  @IsOptional()
  // Blank is how a form sends "no middle name".
  @Matches(new RegExp(`^$|${NAME.source}`, 'u'), { message: 'middleName must be a name' })
  middleName?: string;

  @ApiProperty({ example: 'Mussa' })
  @Matches(NAME, { message: 'lastName must be a name' })
  lastName!: string;

  @ApiProperty({ example: '1990-05-21' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth!: string;

  @ApiProperty({ enum: ['M', 'F'] })
  @IsIn(['M', 'F'])
  gender!: 'M' | 'F';

  @ApiPropertyOptional({ example: 'asha@example.co.tz' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Dar es Salaam' })
  @IsString()
  @Length(2, 40)
  region!: string;

  @ApiProperty({ example: 'Kinondoni' })
  @IsString()
  @Length(2, 60)
  district!: string;

  @ApiProperty({ example: 'Plot 12, Mwenge Road' })
  @IsString()
  @Length(3, 200)
  address!: string;

  @ApiProperty({ example: 'Teacher' })
  @IsString()
  @Length(2, 60)
  occupation!: string;

  @ApiProperty({ enum: SOURCES_OF_FUNDS })
  @IsIn([...SOURCES_OF_FUNDS])
  sourceOfFunds!: string;

  @ApiPropertyOptional({ example: '123-456-789' })
  @IsOptional()
  @Matches(/^\d{3}-?\d{3}-?\d{3}$/, { message: 'tin must be 9 digits' })
  tin?: string;

  @ApiProperty({ description: 'Holds, or is close to someone who holds, a prominent public function' })
  @IsBoolean()
  pepDeclared!: boolean;

  @ApiPropertyOptional({ example: '0150311875201', description: 'Existing TCB account, if any' })
  @IsOptional()
  @Matches(/^\d{10,16}$/, { message: 'tcbAccount must be 10 to 16 digits' })
  tcbAccount?: string;
}

export class SubmitDto {
  @ApiProperty({ description: 'Terms and conditions of the service' })
  @Equals(true, { message: 'The terms must be accepted' })
  acceptTerms!: boolean;

  @ApiProperty({ description: 'Processing of personal data, including checks with NIDA' })
  @Equals(true, { message: 'Consent to data processing is required' })
  acceptDataProcessing!: boolean;

  @ApiProperty({ description: 'Mandate for TCB to open and operate a CDS account' })
  @Equals(true, { message: 'The CDS mandate is required' })
  acceptCdsMandate!: boolean;
}
