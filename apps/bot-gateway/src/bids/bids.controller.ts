import { BadRequestException, Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InternalOnly, Public } from '@govsec/auth';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { toHttp } from '../bot/http-errors';
import { BotService } from '../bot/bot.service';
import { PrismaReconcileStore } from '../reconciliation/prisma-reconcile.store';

const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/;

class BidQueryDto {
  @ApiPropertyOptional({ example: 'TCBGSP01-260925-001' })
  @IsOptional()
  @IsString()
  batchReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiPropertyOptional({ example: 'CDS-TCB-0048213' })
  @IsOptional()
  @IsString()
  securityAccount?: string;

  @ApiPropertyOptional({ enum: ['initiated', 'processing', 'accepted', 'rejected'] })
  @IsOptional()
  @IsIn(['initiated', 'processing', 'accepted', 'rejected'])
  status?: string;
}

class AmendBidDto {
  @ApiProperty({
    example: '89.25',
    description: 'New price per 100; BoT requires it on every amendment',
  })
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'price must have at most two decimals' })
  price!: string;

  @ApiPropertyOptional({ example: '12000000', description: 'New face value, whole shillings' })
  @IsOptional()
  @Matches(/^\d+(\.00)?$/, { message: 'faceValue must be whole shillings as a decimal string' })
  faceValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  competitive?: boolean;
}

/**
 * What BoT holds, and amendments before cut-off — for the auction service only.
 *
 * Reads go straight to BoT rather than to a local copy: the question the auction
 * service asks is precisely "what does BoT say now?". There is no cancel operation,
 * because BoT's API has none (Appendix B, B3); a bid can be withdrawn only before its
 * batch is submitted.
 */
@ApiTags('internal')
@Controller('internal/v1/bids')
export class BidsController {
  constructor(
    private readonly bot: BotService,
    private readonly reconcile: PrismaReconcileStore,
  ) {}

  @Public()
  @InternalOnly('auction')
  @Get(':isin')
  @ApiOperation({ summary: 'Bids BoT holds for an ISIN (auction service only)' })
  async list(@Param('isin') isin: string, @Query() query: BidQueryDto) {
    if (!ISIN.test(isin)) throw new BadRequestException('isin must be a 12-character ISIN');
    try {
      const bids = [];
      // Page through everything BoT holds for the filter (at most 100 per page).
      for (let page = 1; page <= 200; page += 1) {
        const batch = await this.bot.getBids(isin, {
          batchReference: query.batchReference,
          requestId: query.requestId,
          securityAccount: query.securityAccount,
          action: query.status,
          page,
          limit: 100,
        });
        bids.push(...batch);
        if (batch.length < 100) break;
      }
      return { isin, bids };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Public()
  @InternalOnly('auction')
  @Put(':isin/:requestId')
  @ApiOperation({ summary: 'Amend a bid at BoT before cut-off (auction service only)' })
  async amend(
    @Param('isin') isin: string,
    @Param('requestId') requestId: string,
    @Body() body: AmendBidDto,
  ) {
    if (!ISIN.test(isin)) throw new BadRequestException('isin must be a 12-character ISIN');
    try {
      // Read the bid first: its batch and current face value identify which of our
      // submitted bids this amendment changes.
      const [current] = await this.bot.getBids(isin, { requestId });
      if (!current) throw new BadRequestException('BoT holds no bid with that requestId');
      await this.bot.updateBid(isin, requestId, body);
      if (current.securityAccount) {
        await this.reconcile.recordAmendment({
          batchReference: current.batchReference,
          isin,
          securityAccount: current.securityAccount,
          previousFaceValue: current.faceValue,
          faceValue: body.faceValue,
          competitive: body.competitive,
          price: body.price,
        });
      }
      // BoT answers 202: accepted for processing. The outcome is confirmed by reading
      // the bid back, or by the reconciliation that follows.
      return { isin, requestId, status: 'accepted-for-processing' };
    } catch (error) {
      throw toHttp(error);
    }
  }
}
