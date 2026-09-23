import type { Auction, Batch, Bid, Cashflow, Holding, KycCase, ReconRow } from '../types';
import { eatAt } from '../../lib/time';

/**
 * Sample data, taken from the design handover and anchored to "now" so countdowns and
 * SLA ages stay live whenever the demo is opened.
 *
 * Every name, account and ISIN below is fictitious. Bid references use the platform's
 * format (`BD-` + checksummed Crockford base32, @govsec/reference) rather than the
 * design's sequential `BID-2609-00277`, which would publish TCB's daily bid volumes.
 */

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000);
const iso = (date: Date) => date.toISOString();

export interface SeedClock {
  now: Date;
  /** Next auction day's 10:00 EAT cut-off. */
  cutoff: Date;
}

export function seedClock(now = new Date()): SeedClock {
  return { now, cutoff: eatAt(now, 1, 10) };
}

const BILL_RULES = { minimumBid: '500000', bidMultiple: '100000', commissionBps: 10 };
const BOND_RULES = { minimumBid: '1000000', bidMultiple: '100000', commissionBps: 10 };

export function seedAuctions({ cutoff }: SeedClock): Auction[] {
  const day = (days: number) => new Date(cutoff.getTime() + days * 86_400_000);
  const at = (days: number) => iso(day(days));
  return [
    {
      id: 'A1',
      isin: 'TZ1996104321',
      name: '364-day Treasury Bill',
      instrument: { kind: 'bill', days: 364 },
      auctionDate: at(0),
      cutoffAt: at(0),
      offerSize: '120000000000',
      rules: BILL_RULES,
      status: 'Open',
      indicativePrice: '88.50',
    },
    {
      id: 'A2',
      isin: 'TZ1996104206',
      name: '182-day Treasury Bill',
      instrument: { kind: 'bill', days: 182 },
      auctionDate: at(0),
      cutoffAt: at(0),
      offerSize: '45000000000',
      rules: BILL_RULES,
      status: 'Open',
      indicativePrice: '94.20',
    },
    {
      id: 'A3',
      isin: 'TZ1996103876',
      name: '15-year Treasury Bond, 13.50%',
      instrument: { kind: 'bond', years: 15, couponRate: '13.50' },
      auctionDate: at(7),
      cutoffAt: at(7),
      offerSize: '150000000000',
      rules: BOND_RULES,
      status: 'Open',
      indicativePrice: '98.00',
    },
    {
      id: 'A4',
      isin: 'TZ1996104419',
      name: '91-day Treasury Bill',
      instrument: { kind: 'bill', days: 91 },
      auctionDate: at(14),
      cutoffAt: at(14),
      opensAt: at(8),
      offerSize: '30000000000',
      rules: BILL_RULES,
      status: 'Upcoming',
      indicativePrice: '97.60',
    },
    {
      id: 'A5',
      isin: 'TZ1996103551',
      name: '10-year Treasury Bond, 12.75% (reopening)',
      instrument: { kind: 'bond', years: 10, couponRate: '12.75' },
      auctionDate: at(21),
      cutoffAt: at(21),
      opensAt: at(15),
      offerSize: '100000000000',
      rules: BOND_RULES,
      status: 'Upcoming',
      indicativePrice: '97.20',
    },
  ];
}

export const HOLDINGS: Holding[] = [
  {
    isin: 'TZ1996103988',
    name: '364-day Treasury Bill',
    kind: 'bill',
    faceValue: '20000000',
    yield: '12.10',
    maturityDate: '2027-03-12T00:00:00Z',
  },
  {
    isin: 'TZ1996103551',
    name: '10-year Treasury Bond, 12.75%',
    kind: 'bond',
    faceValue: '15000000',
    yield: '13.05',
    maturityDate: '2035-06-18T00:00:00Z',
  },
  {
    isin: 'TZ1996103712',
    name: '182-day Treasury Bill',
    kind: 'bill',
    faceValue: '8500000',
    yield: '10.85',
    maturityDate: '2026-11-04T00:00:00Z',
  },
  {
    isin: 'TZ1996102904',
    name: '5-year Treasury Bond, 11.40%',
    kind: 'bond',
    faceValue: '5000000',
    yield: '11.62',
    maturityDate: '2030-08-22T00:00:00Z',
  },
];

export const CASHFLOWS: Cashflow[] = [
  {
    kind: 'Redemption',
    security: '182-day Treasury Bill',
    amount: '8500000',
    date: '2026-11-04T00:00:00Z',
  },
  {
    kind: 'Coupon',
    security: '10-year Treasury Bond, 12.75%',
    amount: '860625',
    date: '2026-12-18T00:00:00Z',
  },
  {
    kind: 'Coupon',
    security: '5-year Treasury Bond, 11.40%',
    amount: '256500',
    date: '2027-02-22T00:00:00Z',
  },
];

export function seedBids({ cutoff }: SeedClock): Bid[] {
  return [
    {
      reference: 'BD-0DFN6692',
      auctionId: 'A2',
      security: '182-day Treasury Bill',
      auctionDate: iso(cutoff),
      cutoffAt: iso(cutoff),
      type: 'Non-competitive',
      faceValue: '5000000',
      price: null,
      allotted: null,
      heldAmount: '5005000.00',
      status: 'Submitted',
    },
    {
      reference: 'BD-S12HX4TC',
      auctionId: 'H1',
      security: '364-day Treasury Bill',
      auctionDate: '2026-09-10T07:00:00Z',
      cutoffAt: '2026-09-10T07:00:00Z',
      type: 'Competitive',
      faceValue: '20000000',
      price: '88.90',
      allotted: '20000000',
      heldAmount: '0.00',
      status: 'Allotted',
    },
    {
      reference: 'BD-XHSX9BYN',
      auctionId: 'H2',
      security: '10-year Treasury Bond, 12.75%',
      auctionDate: '2026-08-27T07:00:00Z',
      cutoffAt: '2026-08-27T07:00:00Z',
      type: 'Competitive',
      faceValue: '8000000',
      price: '97.20',
      allotted: '5000000',
      heldAmount: '0.00',
      status: 'Partially allotted',
    },
    {
      reference: 'BD-4HX644X9',
      auctionId: 'H3',
      security: '91-day Treasury Bill',
      auctionDate: '2026-08-13T07:00:00Z',
      cutoffAt: '2026-08-13T07:00:00Z',
      type: 'Competitive',
      faceValue: '3000000',
      price: '97.60',
      allotted: '0',
      heldAmount: '0.00',
      status: 'Unsuccessful',
    },
  ];
}

export function seedKyc({ now }: SeedClock): KycCase[] {
  const opened = (hours: number) => iso(hoursAgo(now, hours));
  const f = (label: string, a: string, b: string, r: 0 | 1 | 2) => ({
    label,
    a,
    b,
    result: (['mismatch', 'match', 'n/a'] as const)[r],
  });
  const s = (label: string, result: string, ok: boolean) => ({ label, result, ok });
  const base = { slaHours: 24, status: 'New' as const, makerId: null };
  return [
    {
      ...base,
      id: 'KYC-10482',
      name: 'Juma Hassan Mwinyi',
      type: 'Individual',
      channel: 'USSD',
      reason: 'Name on NIDA does not match the CBS customer record',
      risk: 'Medium',
      openedAt: opened(6.2),
      sourceA: 'NIDA',
      sourceB: 'Core banking',
      fields: [
        f('Full name', 'JUMA HASSAN MWINYI', 'JUMA H. MWINYI', 0),
        f('Date of birth', '14/03/1986', '14/03/1986', 1),
        f('NIDA number', '19860314-11203-00001-24', '19860314-11203-00001-24', 1),
        f('Mobile', '+255 754 •••218', '+255 754 •••218', 1),
      ],
      screening: [
        s('Sanctions lists', 'No match', true),
        s('PEP', 'No match', true),
        s('Adverse media', 'No match', true),
      ],
    },
    {
      ...base,
      id: 'KYC-10477',
      name: 'Grace Ndege',
      type: 'Individual',
      channel: 'Web portal',
      reason: 'Possible PEP match: relative of a public official',
      risk: 'High',
      openedAt: opened(26.7),
      sourceA: 'NIDA',
      sourceB: 'Core banking',
      fields: [
        f('Full name', 'GRACE ANNA NDEGE', 'GRACE ANNA NDEGE', 1),
        f('Date of birth', '02/11/1979', '02/11/1979', 1),
        f('NIDA number', '19791102-14117-00002-11', '19791102-14117-00002-11', 1),
        f('Mobile', '+255 713 •••904', '+255 713 •••904', 1),
      ],
      screening: [
        s('Sanctions lists', 'No match', true),
        s('PEP', 'Match, 87% score', false),
        s('Adverse media', 'No match', true),
      ],
    },
    {
      ...base,
      id: 'KYC-10471',
      name: 'Kilimo Bora Cooperative Ltd',
      type: 'Corporate',
      channel: 'Web portal',
      reason: 'Corporate onboarding: directors and board resolution need review',
      risk: 'Medium',
      openedAt: opened(31.1),
      sourceA: 'BRELA',
      sourceB: 'Submitted',
      fields: [
        f('Registered name', 'KILIMO BORA COOPERATIVE LTD', 'KILIMO BORA COOPERATIVE LTD', 1),
        f('Registration no.', '154872', '154872', 1),
        f('TIN', '128-447-903', '128-447-903', 1),
        f('Directors', '3 on record', '2 declared', 0),
      ],
      screening: [
        s('Sanctions lists', 'No match', true),
        s('PEP (directors)', 'No match', true),
        s('Beneficial owners', '1 missing', false),
      ],
    },
    {
      ...base,
      id: 'KYC-10466',
      name: 'Ali Omar Said',
      type: 'Individual',
      channel: 'Mobile app',
      reason: 'Partial sanctions list name match',
      risk: 'High',
      openedAt: opened(2.8),
      sourceA: 'NIDA',
      sourceB: 'Sanctions entry',
      fields: [
        f('Full name', 'ALI OMAR SAID', 'ALI OMAR SAEED', 0),
        f('Date of birth', '21/07/1992', '1961', 0),
        f('Nationality', 'Tanzanian', 'Other', 0),
        f('NIDA number', '19920721-61104-00003-17', '—', 2),
      ],
      screening: [
        s('Sanctions lists', 'Partial name match, DOB differs', false),
        s('PEP', 'No match', true),
        s('Adverse media', 'No match', true),
      ],
    },
    {
      ...base,
      id: 'KYC-10459',
      name: 'Neema Mushi (minor)',
      type: 'Minor via guardian',
      channel: 'Web portal',
      reason: 'Guardian relationship needs a birth certificate check',
      risk: 'Low',
      openedAt: opened(4.3),
      sourceA: 'Guardian NIDA',
      sourceB: 'Birth certificate',
      fields: [
        f('Guardian', 'PAUL MUSHI', 'PAUL MUSHI', 1),
        f('Minor name', '—', 'NEEMA PAUL MUSHI', 2),
        f('Minor DOB', '—', '09/05/2015', 2),
        f('Relationship', 'Father', 'Father', 1),
      ],
      screening: [
        s('Sanctions lists (guardian)', 'No match', true),
        s('PEP (guardian)', 'No match', true),
      ],
    },
  ];
}

export function seedBatches({ now, cutoff }: SeedClock): Batch[] {
  const consolidated = iso(eatAt(now, 0, 9));
  const common = {
    cutoffAt: iso(cutoff),
    consolidatedAt: consolidated,
    approvedBy: null,
    batchReference: null,
    acknowledgedAt: null,
  };
  return [
    {
      ...common,
      id: 'B1',
      auctionId: 'A1',
      name: '364-day Treasury Bill',
      isin: 'TZ1996104321',
      bids: 842,
      competitive: 611,
      nonCompetitive: 231,
      faceValue: '58200000000',
      fundsHeld: '58258200000',
      stage: 'Awaiting checker',
      preparedBy: { id: 'u-maker', name: 'R. Mollel', at: iso(eatAt(now, 0, 9, 14)) },
    },
    {
      ...common,
      id: 'B2',
      auctionId: 'A2',
      name: '182-day Treasury Bill',
      isin: 'TZ1996104206',
      bids: 356,
      competitive: 214,
      nonCompetitive: 142,
      faceValue: '21700000000',
      fundsHeld: '21721700000',
      stage: 'Awaiting maker',
      preparedBy: null,
    },
  ];
}

export function seedRecon(): ReconRow[] {
  const ok = {
    result: 'Matched' as const,
    breakSide: null,
    detail: '',
    action: null,
    resolvedBy: null,
  };
  return [
    {
      ...ok,
      id: 'R1',
      investor: 'Halima Juma Kombo',
      cdsAccount: 'CDS-TCB-0039920',
      allocation: '12000000',
      cbsDebit: '10678800',
      cdsCredit: '12000000',
    },
    {
      id: 'R2',
      investor: 'Baraka Joseph Lema',
      cdsAccount: 'CDS-TCB-0041187',
      allocation: '5000000',
      cbsDebit: null,
      cdsCredit: '5000000',
      result: 'Break',
      breakSide: 'cbs',
      detail: 'CBS debit missing. Hold not converted: account frozen after hold.',
      action: 'Raise CBS ticket',
      resolvedBy: null,
    },
    {
      id: 'R3',
      investor: 'Upendo Microfinance Ltd',
      cdsAccount: 'CDS-TCB-0027715',
      allocation: '250000000',
      cbsDebit: '222475000',
      cdsCredit: '200000000',
      result: 'Break',
      breakSide: 'cds',
      detail: 'CDS credit is 50,000,000 short of allocation.',
      action: 'Query BoT CDS',
      resolvedBy: null,
    },
    {
      ...ok,
      id: 'R4',
      investor: 'Salim Rashid Nassor',
      cdsAccount: 'CDS-TCB-0045530',
      allocation: '2000000',
      cbsDebit: '1779800',
      cdsCredit: '2000000',
    },
    {
      id: 'R5',
      investor: 'Rehema Paulo Kimaro',
      cdsAccount: 'CDS-TCB-0046102',
      allocation: '1000000',
      cbsDebit: '1779800',
      cdsCredit: '1000000',
      result: 'Break',
      breakSide: 'cbs',
      detail: 'Debited twice the settlement amount. Duplicate posting.',
      action: 'Reverse duplicate',
      resolvedBy: null,
    },
    {
      ...ok,
      id: 'R6',
      investor: 'Amina Said Mfinanga',
      cdsAccount: 'CDS-TCB-0048213',
      allocation: '20000000',
      cbsDebit: '17798000',
      cdsCredit: '20000000',
    },
  ];
}
