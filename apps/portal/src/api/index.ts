import { MockPortalApi } from './mock/mock-api';
import type { PortalApi } from './types';

/**
 * The single API instance the stores use.
 *
 * All data is mocked for now. `?funds=low` starts the investor with the design's
 * insufficient-funds balance, to demonstrate that path.
 */
function startingBalance(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('funds') === 'low'
    ? '6200000.00'
    : undefined;
}

export const api: PortalApi = new MockPortalApi({ availableBalance: startingBalance() });

export * from './types';
