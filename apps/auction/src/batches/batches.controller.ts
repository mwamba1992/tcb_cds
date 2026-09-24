import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import {
  CurrentUser,
  PERMISSIONS,
  RequirePermissions,
  RequireStepUp,
  StepUp,
  type AuthenticatedUser,
  type StepUpTokenClaims,
} from '@govsec/auth';
import { TableQuery } from '@govsec/pagination';
import { CatalogueService } from '../catalogue/catalogue.service';
import { BatchesService } from './batches.service';

class ReasonDto {
  @IsString()
  @Length(3, 500, { message: 'Give a reason (at least 3 characters)' })
  reason!: string;
}

class PrepareDto {
  @Matches(/^[A-Z]{2}[A-Z0-9]{10}$/)
  isin!: string;
}

class BatchQuery extends TableQuery {
  @IsOptional()
  @IsIn(['prepared', 'approved', 'submitted', 'failed', 'reconciled'])
  status?: string;
}

@ApiTags('bid submission')
@ApiBearerAuth()
@Controller('v1/staff')
export class StaffAuctionsController {
  constructor(
    private readonly batches: BatchesService,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get('auctions')
  @RequirePermissions(PERMISSIONS.bidReadAll)
  @ApiOperation({ summary: 'Each recent auction: bids, cut-off and batch stage' })
  control() {
    return this.batches.control();
  }

  @Post('auctions/:isin/close-bidding')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.auctionManage)
  @ApiOperation({ summary: 'Bring TCB’s cut-off forward to now, with a reason' })
  close(@CurrentUser() user: AuthenticatedUser, @Param('isin') isin: string, @Body() dto: ReasonDto) {
    return this.catalogue.closeBidding(isin, user, dto.reason);
  }

  @Get('batches')
  @RequirePermissions(PERMISSIONS.bidReadAll)
  list(@Query() query: BatchQuery) {
    return this.batches.list(query);
  }

  @Get('batches/:id')
  @RequirePermissions(PERMISSIONS.bidReadAll)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.batches.get(id);
  }

  @Post('batches')
  @RequirePermissions(PERMISSIONS.batchPrepare)
  @ApiOperation({ summary: 'Maker: gather the bids of an auction whose bidding has closed' })
  prepare(@CurrentUser() user: AuthenticatedUser, @Body() dto: PrepareDto) {
    return this.batches.prepare(user, dto.isin);
  }

  @Post('batches/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.batchApprove)
  @RequireStepUp(PERMISSIONS.batchApprove)
  @ApiOperation({ summary: 'Checker: approve and send to BoT (a different user; fresh approval)' })
  approve(@CurrentUser() user: AuthenticatedUser, @StepUp() stepUp: StepUpTokenClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.approve(user, stepUp, id);
  }

  @Post('batches/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.batchApprove)
  @ApiOperation({ summary: 'Send again a batch that failed to reach BoT' })
  resubmit(@Param('id', ParseUUIDPipe) id: string) {
    return this.batches.submit(id);
  }
}
