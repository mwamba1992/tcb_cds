import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsISO8601, IsString, Length, Matches } from 'class-validator';
import { InternalOnly, Public } from '@govsec/auth';
import { CONFIG, type CbsGatewayConfig } from '../config/configuration';
import { AccountOpeningService } from './account-opening.service';
import { CORE_BANKING, type CbsCustomer, type CoreBanking } from './core-banking';

const NIDA = /^\d{20}$/;
const ACCOUNT = /^\d{10,16}$/;

class CustomerLookupDto {
  @Matches(NIDA, { message: 'nidaNumber must be 20 digits' })
  nidaNumber!: string;
}

class AccountLookupDto {
  @Matches(ACCOUNT, { message: 'accountNumber must be 10 to 16 digits' })
  accountNumber!: string;
}

class AccountOpeningDto {
  @Matches(/^[0-9a-f-]{36}$/)
  investorId!: string;

  @Matches(NIDA)
  nidaNumber!: string;

  @IsString()
  @Length(3, 200)
  fullName!: string;

  @IsISO8601({ strict: true })
  dateOfBirth!: string;
}

class MarkOpenedDto {
  @Matches(ACCOUNT)
  accountNumber!: string;
}

/**
 * Core Banking for the rest of the platform. Only the investor service calls it
 * today; the settlement service will add holds and debits here.
 */
@ApiExcludeController()
@Public()
@Controller('internal/v1')
export class InternalCbsController {
  constructor(
    @Inject(CORE_BANKING) private readonly cbs: CoreBanking,
    private readonly openings: AccountOpeningService,
    @Inject(CONFIG) private readonly config: CbsGatewayConfig,
  ) {}

  /** POST, not GET: a NIDA number in a URL ends up in access logs. */
  @InternalOnly('investor')
  @Post('customers/lookup')
  @HttpCode(HttpStatus.OK)
  async lookupByNida(@Body() dto: CustomerLookupDto) {
    return customerView(await this.cbs.findCustomerByNida(dto.nidaNumber));
  }

  @InternalOnly('investor')
  @Post('accounts/lookup')
  @HttpCode(HttpStatus.OK)
  async lookupByAccount(@Body() dto: AccountLookupDto) {
    return customerView(await this.cbs.findCustomerByAccount(dto.accountNumber));
  }

  @InternalOnly('investor')
  @Post('account-openings')
  async requestOpening(@Body() dto: AccountOpeningDto) {
    return this.openings.request(dto);
  }

  /**
   * Stub mode only: stands in for Core Banking telling us the account is open. With
   * a live Core Banking this endpoint refuses, and the notice comes from TCB.
   */
  @InternalOnly('investor', 'dev')
  @Post('account-openings/:reference/opened')
  async markOpened(@Param('reference') reference: string, @Body() dto: MarkOpenedDto) {
    if (this.config.cbs.mode !== 'stub') {
      throw new ForbiddenException('Only available while Core Banking is stubbed');
    }
    return this.openings.markOpened(reference, dto.accountNumber);
  }
}

function customerView(customer: CbsCustomer | null) {
  if (!customer) return { found: false as const };
  return {
    found: true as const,
    customerId: customer.customerId,
    fullName: customer.fullName,
    dateOfBirth: customer.dateOfBirth,
    nidaNumber: customer.nidaNumber,
    accounts: customer.accounts,
  };
}
