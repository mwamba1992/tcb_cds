import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * SMS delivery. A stand-in until TCB chooses a provider — an aggregator or a direct MNO
 * bulk-SMS agreement is a commercial decision.
 *
 * Worth knowing before signing: sender IDs must be registered with TCRA, and
 * unregistered traffic is dropped rather than bounced, so a working sandbox says little
 * about production delivery.
 */
export interface ChannelResult {
  delivered: boolean;
  providerRef?: string;
  failureReason?: string;
}

export interface SmsChannel {
  send(to: string, body: string): Promise<ChannelResult>;
}

@Injectable()
export class StubSmsChannel implements SmsChannel {
  async send(to: string, body: string): Promise<ChannelResult> {
    if (!/^\+255\d{9}$/.test(to)) {
      return { delivered: false, failureReason: 'Not a Tanzanian mobile number (+255…)' };
    }
    // One real rejection kept live so callers cannot forget that delivery can fail.
    if (body.length > 306) {
      return { delivered: false, failureReason: 'Message longer than two SMS segments' };
    }
    return { delivered: true, providerRef: `STUB-SMS-${randomUUID().slice(0, 10).toUpperCase()}` };
  }
}
