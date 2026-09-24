import { tableOrder, tableWindow } from './pagination';

describe('back-office table paging', () => {
  it('defaults to page 1 of 25', () => {
    expect(tableWindow({})).toEqual({ skip: 0, take: 25, page: 1, pageSize: 25 });
    expect(tableWindow({ page: 3, pageSize: 50 })).toEqual({ skip: 100, take: 50, page: 3, pageSize: 50 });
  });

  it('sorts only by allowed fields, always with the id tiebreaker', () => {
    const allowed = { name: 'lastName', registered: 'createdAt' };
    const fallback = { field: 'registered' as const, dir: 'desc' as const };
    expect(tableOrder('name:asc', allowed, fallback)).toEqual([{ lastName: 'asc' }, { id: 'asc' }]);
    expect(tableOrder('password:asc', allowed, fallback)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(tableOrder(undefined, allowed, fallback)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
