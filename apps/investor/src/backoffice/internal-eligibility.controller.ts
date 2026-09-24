import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly, Public } from '@govsec/auth';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Whether an account may bid, and with which accounts. Asked by the auction service
 * on every bid, not cached there: an investor whose CDS account is revoked must stop
 * bidding at once, not when a cache expires.
 */
@ApiExcludeController()
@Public()
@Controller('internal/v1/investors')
export class InternalEligibilityController {
  constructor(private readonly prisma: PrismaService) {}

  @InternalOnly('auction', 'settlement')
  @Get('by-account/:accountId')
  async byAccount(@Param('accountId', ParseUUIDPipe) accountId: string) {
    const investor = await this.prisma.investor.findUnique({ where: { accountId }, include: { individual: true } });
    if (!investor) throw new NotFoundException('No investor for this account');
    const p = investor.individual;
    return {
      investorId: investor.id,
      reference: investor.reference,
      name: p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : null,
      firstName: p?.firstName ?? null,
      canBid: investor.status === 'approved' && investor.cdsStatus === 'active' && investor.bankAccount !== null,
      status: investor.status,
      cdsAccount: investor.cdsAccount,
      bankAccount: investor.bankAccount,
    };
  }
}
