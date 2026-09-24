import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/**
 * One pagination contract, for every list endpoint on the platform.
 *
 * It existed in eighteen slightly different versions before this: caps of 100 or 200,
 * defaults of 20, 24, 25, 40 or 50, and a cursor on six endpoints out of eighteen. None
 * of those differences meant anything — they were the order the endpoints were written
 * in. A client could not learn the rule once and rely on it, and a reviewer could not
 * tell a deliberate cap from a typo.
 *
 * The three rules:
 *
 *  1. **Keyset, not offset.** `before` is the sort value of the last row you saw.
 *     `OFFSET 400` re-reads four hundred rows to skip them, and on a list that is being
 *     written to it silently repeats and drops records as rows shift beneath the offset.
 *  2. **Always a unique tiebreaker.** Ordering by `createdAt` alone lets two rows sharing
 *     a timestamp swap between requests, so one is served twice and the other never. On
 *     a review queue that is an applicant nobody ever sees.
 *  3. **The cap is the contract.** A caller that asks for more gets a 400, not a silent
 *     truncation — because a silently truncated list looks exactly like a complete one.
 */

/** What a caller gets without asking. Big enough to fill a screen, small enough to be cheap. */
export const PAGE_DEFAULT = 50;

/**
 * The most any single request may return.
 *
 * 200 rather than 1000: past a couple of hundred rows nobody is reading, they are
 * exporting — and an export wants a job with a cursor, not a bigger page.
 */
export const PAGE_MAX = 200;

/**
 * Base class for a paginated query.
 *
 * Extend it rather than redeclaring `limit`, so a service cannot drift to its own cap
 * without that being a visible, deliberate override.
 */
export class PageQuery {
  @ApiPropertyOptional({ default: PAGE_DEFAULT, maximum: PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Cursor. Pass the `next_before` from the previous page to get the one after it.',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;
}

/** The page size to actually use, whatever the caller did or did not send. */
export function pageSize(limit?: number): number {
  if (!limit || limit < 1) return PAGE_DEFAULT;
  return Math.min(limit, PAGE_MAX);
}

/**
 * The `where` fragment for a cursor, or nothing on the first page.
 *
 * `column` must be the same column the query sorts by, or the cursor walks a different
 * sequence from the one on screen and pages overlap.
 */
export function cursorWhere(
  column: string,
  before: string | undefined,
  direction: 'asc' | 'desc' = 'desc',
): Record<string, { lt: Date } | { gt: Date }> {
  if (!before) return {};
  const at = new Date(before);
  if (Number.isNaN(at.getTime())) return {};
  return { [column]: direction === 'desc' ? { lt: at } : { gt: at } };
}

/**
 * Wrap a page of rows with the cursor for the next one.
 *
 * `next_before` is null when the page came back short of the limit, which is the only
 * honest signal that there is nothing more — a non-null cursor on a final page sends the
 * client round one extra time for an empty answer.
 */
export function page<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => Date | string,
): { next_before: string | null } {
  if (rows.length < limit) return { next_before: null };
  const last = rows[rows.length - 1];
  if (last === undefined) return { next_before: null };
  const value = cursorOf(last);
  return { next_before: value instanceof Date ? value.toISOString() : value };
}

// ---------------------------------------------------------------- back-office tables

/**
 * Numbered pages with a total, for back-office tables only.
 *
 * Staff need what keyset paging cannot give: "312 customers", "page 3 of 13", jump to
 * a page. Back-office lists run to thousands of rows, not millions, so the cost of an
 * offset is small, and every table sorts with a unique tiebreaker so rows cannot swap
 * between pages. Feeds that customers scroll, and anything unbounded (events, audit
 * trails, callbacks), stay on keyset paging above.
 *
 * One shape everywhere: `?page=1&pageSize=25&q=…&sort=field:asc` in, `TablePage` out.
 */
export const TABLE_PAGE_SIZES = [25, 50, 100] as const;
export const TABLE_PAGE_DEFAULT = 25;

export class TableQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @ApiPropertyOptional({ default: TABLE_PAGE_DEFAULT, enum: TABLE_PAGE_SIZES })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([...TABLE_PAGE_SIZES])
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Free-text search; each table says what it matches' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  @ApiPropertyOptional({ description: 'field:asc or field:desc; each table lists its fields' })
  @IsOptional()
  @Matches(/^[a-zA-Z]+:(asc|desc)$/, { message: 'sort must look like createdAt:desc' })
  sort?: string;
}

export interface TablePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** skip/take for a TableQuery, with defaults applied. */
export function tableWindow(query: TableQuery): { skip: number; take: number; page: number; pageSize: number } {
  const pageSize = query.pageSize ?? TABLE_PAGE_DEFAULT;
  const page = query.page ?? 1;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

/**
 * Resolve `sort` against the fields a table allows, falling back to its default.
 * Always appends `id` as the tiebreaker.
 */
export function tableOrder<F extends string>(
  sort: string | undefined,
  allowed: Record<F, string>,
  fallback: { field: NoInfer<F>; dir: 'asc' | 'desc' },
): Record<string, 'asc' | 'desc'>[] {
  const [field, dir] = (sort ?? '').split(':') as [string, 'asc' | 'desc' | undefined];
  const column = field && field in allowed ? allowed[field as F] : allowed[fallback.field];
  const direction = field && field in allowed && dir ? dir : fallback.dir;
  return [{ [column]: direction }, { id: direction }];
}

export function tablePage<T>(items: T[], total: number, window: { page: number; pageSize: number }): TablePage<T> {
  return { items, total, page: window.page, pageSize: window.pageSize };
}
