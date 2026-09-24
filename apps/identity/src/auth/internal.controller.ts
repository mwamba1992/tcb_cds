import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { InternalOnly, Public, STEP_UP_REQUIRED, type Permission } from '@govsec/auth';
import { PrismaService } from '../prisma/prisma.service';
import { StepUpService } from './step-up.service';

class RedeemStepUpDto {
  @IsUUID()
  grantId!: string;

  @IsUUID()
  accountId!: string;

  @IsIn([...STEP_UP_REQUIRED])
  scope!: string;

  /** Minor units as a string; a JSON number would be a double. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'amountMinor must be a whole number as a string' })
  amountMinor?: string;
}

/**
 * Service-to-service endpoints: excluded from the public API document and refused
 * without the internal secret. `@Public()` only turns off the *user* token guard.
 */
@ApiExcludeController()
@Controller('internal/v1')
export class InternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUps: StepUpService,
  ) {}

  /**
   * How to reach an account holder. Events carry only the account id, so a service
   * that must send an SMS asks here. Contact details only: no role, status or
   * credential.
   */
  @Public()
  @InternalOnly('investor', 'auction', 'settlement', 'notification')
  @Get('accounts/:id/contact')
  async contact(@Param('id', ParseUUIDPipe) id: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, phoneNumber: true, locale: true },
    });
    // Staff accounts may have no phone; for a caller that means nowhere to send.
    if (!account?.phoneNumber) throw new NotFoundException('Account not found');
    return { accountId: account.id, phoneNumber: account.phoneNumber, locale: account.locale };
  }

  /** Spend a PIN approval, as the action it authorised commits. */
  @Public()
  @InternalOnly('auction', 'investor', 'settlement')
  @Post('step-up/redeem')
  @HttpCode(HttpStatus.NO_CONTENT)
  async redeem(@Body() dto: RedeemStepUpDto): Promise<void> {
    await this.stepUps.redeem({
      grantId: dto.grantId,
      accountId: dto.accountId,
      scope: dto.scope as Permission,
      ...(dto.amountMinor !== undefined ? { amountMinor: BigInt(dto.amountMinor) } : {}),
    });
  }
}
