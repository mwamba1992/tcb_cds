import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import {
  CurrentUser,
  PERMISSIONS,
  RequirePermissions,
  RequireStepUp,
  Roles,
  ROLES,
  StepUp,
  type AuthenticatedUser,
  type StepUpTokenClaims,
} from '@govsec/auth';
import { CatalogueService } from '../catalogue/catalogue.service';
import { BidsService } from './bids.service';

class PlaceBidDto {
  @Matches(/^[A-Z]{2}[A-Z0-9]{10}$/, { message: 'isin must be a 12-character ISIN' })
  isin!: string;

  @IsBoolean()
  competitive!: boolean;

  @Matches(/^\d{1,15}$/, { message: 'faceValue must be whole shillings as a string' })
  faceValue!: string;

  @IsOptional()
  @IsString()
  price?: string | null;
}

class AmendBidDto {
  @Matches(/^\d{1,15}$/, { message: 'faceValue must be whole shillings as a string' })
  faceValue!: string;

  @IsOptional()
  @IsString()
  price?: string | null;
}

@ApiTags('auctions')
@ApiBearerAuth()
@Controller('v1')
export class InvestorAuctionsController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly bids: BidsService,
  ) {}

  @Get('auctions')
  @RequirePermissions(PERMISSIONS.auctionRead)
  @ApiOperation({ summary: 'Recent and upcoming auctions with TCB’s cut-off and bid rules' })
  auctions() {
    return this.catalogue.list();
  }

  @Get('auctions/:isin')
  @RequirePermissions(PERMISSIONS.auctionRead)
  auction(@Param('isin') isin: string) {
    return this.catalogue.get(isin);
  }

  @Get('me/funds')
  @Roles(ROLES.investor)
  @ApiOperation({ summary: 'The investor’s TCB account: available and on hold' })
  funds(@CurrentUser() user: AuthenticatedUser) {
    return this.bids.funds(user);
  }

  @Get('bids')
  @Roles(ROLES.investor)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.bids.mine(user);
  }

  @Post('bids')
  @Roles(ROLES.investor)
  @RequireStepUp(PERMISSIONS.bidPlace)
  @ApiHeader({ name: 'x-step-up-token', description: 'PIN approval for bid:place covering the amount held' })
  @ApiHeader({ name: 'idempotency-key', required: false, description: 'Retrying with the same key returns the same bid' })
  @ApiOperation({ summary: 'Place a bid; funds are held on the investor’s TCB account' })
  place(
    @CurrentUser() user: AuthenticatedUser,
    @StepUp() stepUp: StepUpTokenClaims,
    @Body() dto: PlaceBidDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.bids.place(user, stepUp, dto, idempotencyKey?.slice(0, 80));
  }

  @Put('bids/:reference')
  @Roles(ROLES.investor)
  @RequireStepUp(PERMISSIONS.bidAmendOwn)
  @ApiOperation({ summary: 'Change amount or price before TCB’s cut-off; the hold follows' })
  amend(
    @CurrentUser() user: AuthenticatedUser,
    @StepUp() stepUp: StepUpTokenClaims,
    @Param('reference') reference: string,
    @Body() dto: AmendBidDto,
  ) {
    return this.bids.amend(user, stepUp, reference, dto);
  }

  @Post('bids/:reference/withdraw')
  @Roles(ROLES.investor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw before TCB’s cut-off; the hold is released' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.bids.withdraw(user, reference);
  }
}
