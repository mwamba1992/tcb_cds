import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentUser, PERMISSIONS, RequirePermissions, type AuthenticatedUser } from '@govsec/auth';
import { CdsService } from './cds.service';
import { KYC_ACTIONS, KycService, type KycAction } from './kyc.service';

class KycActionDto {
  @IsIn([...KYC_ACTIONS])
  action!: KycAction;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

class CompleteCdsDto {
  @Matches(/^[A-Z0-9-]{4,20}$/, { message: 'cdsAccount must be 4 to 20 letters, digits or hyphens' })
  cdsAccount!: string;
}

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('v1/kyc/cases')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.kycReview)
  @ApiOperation({ summary: 'Open cases, oldest first (or those in ?status=)' })
  list(@Query('status') status?: string) {
    return this.kyc.list(status);
  }

  @Get(':reference')
  @RequirePermissions(PERMISSIONS.kycReview)
  get(@Param('reference') reference: string) {
    return this.kyc.get(reference);
  }

  @Post(':reference/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.kycReview)
  @ApiOperation({ summary: 'Maker: approve / request-info / reject. Checker: final-approve / return' })
  act(@Param('reference') reference: string, @Body() dto: KycActionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.kyc.act(reference, dto.action, dto.note, user);
  }
}

@ApiTags('cds')
@ApiBearerAuth()
@Controller('v1/cds/requests')
export class CdsController {
  constructor(private readonly cds: CdsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.cdsOpen)
  @ApiOperation({ summary: 'Approved investors waiting for a CDS account' })
  pending() {
    return this.cds.pending();
  }

  @Post(':reference/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.cdsOpen)
  @ApiOperation({ summary: 'Record the CDS account opened for the investor' })
  complete(@Param('reference') reference: string, @Body() dto: CompleteCdsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cds.complete(reference, dto.cdsAccount, user.accountId);
  }
}
