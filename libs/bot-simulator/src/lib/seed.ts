import type { SimAuction } from './simulator';

/**
 * Sample auctions for the simulator, matching the portal's mock data so the two tell
 * the same story in a demo.
 *
 * Bills close at 10:00 EAT (07:00 UTC) on the next day; the bond a week later. `cutoffAt`
 * is internal to the simulator: BoT's AuctionItem carries no cut-off time (TAD
 * Appendix B, B4), so the simulator does not send one either.
 */
export function seedAuctions(now: Date = new Date()): SimAuction[] {
  const cutoff = (days: number) => {
    const at = new Date(now);
    at.setUTCDate(at.getUTCDate() + days);
    at.setUTCHours(7, 0, 0, 0);
    return at;
  };
  const date = (d: Date) => d.toISOString().slice(0, 10);
  const bills = cutoff(1);
  const bond = cutoff(8);

  return [
    {
      ISIN: 'TZ1996104321',
      securityName: '364-DAY TREASURY BILL',
      instrumentType: 'TBILLS',
      auctionDate: date(bills),
      maturityDate: date(new Date(bills.getTime() + 364 * 86_400_000)),
      tenderedSizeCompetitive: 110_000_000_000,
      tenderedSizeNonCompetitive: 10_000_000_000,
      status: 'OPEN',
      cutoffAt: bills,
    },
    {
      ISIN: 'TZ1996104206',
      securityName: '182-DAY TREASURY BILL',
      instrumentType: 'TBILLS',
      auctionDate: date(bills),
      maturityDate: date(new Date(bills.getTime() + 182 * 86_400_000)),
      tenderedSizeCompetitive: 40_000_000_000,
      tenderedSizeNonCompetitive: 5_000_000_000,
      status: 'OPEN',
      cutoffAt: bills,
    },
    {
      ISIN: 'TZ1996103876',
      securityName: '15-YEAR TREASURY BOND',
      instrumentType: 'TBONDS',
      auctionDate: date(bond),
      maturityDate: date(new Date(bond.getTime() + 15 * 365 * 86_400_000)),
      tenderedSizeCompetitive: 140_000_000_000,
      tenderedSizeNonCompetitive: 10_000_000_000,
      status: 'OPEN',
      cutoffAt: bond,
    },
  ];
}
