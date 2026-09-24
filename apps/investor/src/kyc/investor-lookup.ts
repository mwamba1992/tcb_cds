import { Controller, Get, Injectable, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, RequirePermissions } from '@govsec/auth';
import { isValidReference, normaliseReference } from '@govsec/reference';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One investor as the back office sees them, by the NV- reference the customer
 * quotes on the phone: details, account status, checks, cases and every staff action.
 */
@Injectable()
export class InvestorLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async byReference(raw: string) {
    // Validated before any query: a mistyped reference never becomes a lookup.
    if (!isValidReference(raw, 'investor')) throw new NotFoundException('No investor with that reference');
    const investor = await this.prisma.investor.findUnique({
      where: { reference: normaliseReference(raw) },
      include: {
        individual: true,
        verifications: { orderBy: { checkedAt: 'desc' } },
        kycCases: { orderBy: { openedAt: 'desc' } },
        cdsRequests: true,
      },
    });
    if (!investor) throw new NotFoundException('No investor with that reference');
    const actions = await this.prisma.staffAction.findMany({
      where: { investorId: investor.id },
      orderBy: { at: 'asc' },
    });
    const p = investor.individual;
    return {
      reference: investor.reference,
      type: investor.type,
      status: investor.status,
      risk: investor.risk,
      name: p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : null,
      nidaNumber: p?.nidaNumber ?? null,
      dateOfBirth: p?.dateOfBirth.toISOString().slice(0, 10) ?? null,
      region: p?.region ?? null,
      occupation: p?.occupation ?? null,
      sourceOfFunds: p?.sourceOfFunds ?? null,
      pepDeclared: p?.pepDeclared ?? null,
      bank: { status: investor.bankStatus, account: investor.bankAccount, openingRef: investor.accountOpeningRef },
      cds: { status: investor.cdsStatus, account: investor.cdsAccount },
      submittedAt: investor.submittedAt,
      approvedAt: investor.approvedAt,
      checks: investor.verifications.map((v) => ({ source: v.source, outcome: v.outcome, at: v.checkedAt, details: v.details })),
      cases: investor.kycCases.map((k) => ({ reference: k.reference, status: k.status, risk: k.risk, openedAt: k.openedAt })),
      history: actions.map((a) => ({ action: a.action, by: a.actorName, role: a.actorRole, subject: a.subjectRef, note: a.note, at: a.at })),
    };
  }
}

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('v1/investors')
export class InvestorLookupController {
  constructor(private readonly lookup: InvestorLookupService) {}

  @Get(':reference')
  @RequirePermissions(PERMISSIONS.kycReview)
  @ApiOperation({ summary: 'Staff: one investor by NV- reference, with checks and history' })
  get(@Param('reference') reference: string) {
    return this.lookup.byReference(reference);
  }
}
