import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { InternalOnly, Public } from '@govsec/auth';
import { HoldsService } from './holds.service';

const AMOUNT = /^\d{1,15}(\.\d{1,2})?$/;

class PlaceHoldDto {
  @Matches(/^BD-[0-9A-Z]{8}$/, { message: 'reference must be a BD- bid reference' })
  reference!: string;

  @Matches(/^\d{10,16}$/)
  accountNumber!: string;

  @Matches(AMOUNT, { message: 'amount must be a TZS decimal string' })
  amount!: string;
}

class AdjustHoldDto {
  @Matches(AMOUNT, { message: 'amount must be a TZS decimal string' })
  amount!: string;
}

/** Holds on TCB accounts, for the services that move money for bids. */
@ApiExcludeController()
@Public()
@Controller('internal/v1')
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  @InternalOnly('auction', 'settlement')
  @Get('accounts/:accountNumber/balance')
  balance(@Param('accountNumber') accountNumber: string) {
    return this.holds.balance(accountNumber);
  }

  @InternalOnly('auction')
  @Post('holds')
  place(@Body() dto: PlaceHoldDto) {
    return this.holds.place(dto.reference, dto.accountNumber, dto.amount);
  }

  @InternalOnly('auction')
  @Put('holds/:reference')
  adjust(@Param('reference') reference: string, @Body() dto: AdjustHoldDto) {
    return this.holds.adjust(reference, dto.amount);
  }

  @InternalOnly('auction', 'settlement')
  @Post('holds/:reference/release')
  @HttpCode(HttpStatus.OK)
  release(@Param('reference') reference: string) {
    return this.holds.release(reference);
  }
}
