import { Body, Controller, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InternalOnly, Public } from '@govsec/auth';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { BotApiError } from '../bot/bot-transport';
import { BotValidationError } from '../bot/bot.service';
import { BatchSubmissionService } from './batch-submission.service';

class BidDto {
  @ApiProperty({ example: 'CDS-TCB-0048213' })
  @IsString()
  @IsNotEmpty()
  securityAccount!: string;

  @ApiProperty({
    example: '10000000',
    description: 'Face value in whole shillings, as a decimal string',
  })
  @Matches(/^\d+(\.00)?$/, { message: 'faceValue must be whole shillings as a decimal string' })
  faceValue!: string;

  @ApiProperty()
  @IsBoolean()
  competitive!: boolean;

  @ApiProperty({
    example: '88.50',
    nullable: true,
    description: 'Price per 100; null when non-competitive',
  })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'price must have at most two decimals' })
  price!: string | null;
}

class PackageDto {
  @ApiProperty({ example: 'TZ1996104321' })
  @Matches(/^[A-Z]{2}[A-Z0-9]{10}$/, { message: 'isin must be a 12-character ISIN' })
  isin!: string;

  @ApiProperty({ type: [BidDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BidDto)
  bids!: BidDto[];
}

class SubmitBatchDto {
  @ApiProperty({ type: [PackageDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PackageDto)
  packages!: PackageDto[];
}

/**
 * Batch submission to BoT, for the auction service only (TAD §5.2, §7.3).
 *
 * @Public because the caller is a service, not a person; @InternalOnly('auction') is
 * the actual gate. No other service may submit bids to the Bank of Tanzania.
 */
@ApiTags('internal')
@Controller('internal/v1/batches')
export class BatchController {
  constructor(private readonly batches: BatchSubmissionService) {}

  @Public()
  @InternalOnly('auction')
  @Post(':batchReference')
  @ApiOperation({ summary: 'Submit an approved batch to BoT (auction service only)' })
  async submit(@Param('batchReference') batchReference: string, @Body() body: SubmitBatchDto) {
    try {
      const { submission, replayed } = await this.batches.submit(
        batchReference,
        body.packages.map((p) => ({
          isin: p.isin,
          bids: p.bids.map((b) => ({ ...b, price: b.price ?? null })),
        })),
        'auction',
      );
      return { ...submission, replayed };
    } catch (error) {
      throw toHttp(error);
    }
  }
}

/**
 * BoT's answers mapped for the caller: our own validation and BoT's 4xx are the
 * request's fault (422, or 409 for a cut-off); BoT being down or refusing our
 * credentials is not the caller's fault and is a 502 it may retry.
 */
function toHttp(error: unknown): HttpException {
  if (error instanceof BotValidationError) {
    return new HttpException(
      { code: 'INVALID_BATCH', message: error.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (error instanceof BotApiError) {
    const body = { code: error.code, message: error.message, botStatus: error.status };
    if (error.status === 409) return new HttpException(body, HttpStatus.CONFLICT);
    if (error.status >= 400 && error.status < 500 && error.status !== 401) {
      return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return new HttpException(body, HttpStatus.BAD_GATEWAY);
  }
  return new HttpException(
    { code: 'INTERNAL', message: 'Batch submission failed' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
