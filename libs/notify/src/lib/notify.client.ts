import { Injectable, Logger } from '@nestjs/common';
import { internalHeaders } from '@govsec/auth';

export interface NotifyOptions {
  notificationUrl: string;
  internalSecret: string;
  /** The calling service's name, for @InternalOnly. */
  serviceName: string;
}

export interface NotifyRequest {
  /** Tanzanian mobile number, +255… */
  destination: string;
  /** A key from apps/notification/src/templates/templates.ts, e.g. 'otp.registration'. */
  templateKey: string;
  category: 'security' | 'money' | 'auction' | 'account' | 'marketing';
  variables: Record<string, string>;
  /** Kiswahili by default. */
  locale?: 'en' | 'sw';
}

/**
 * Sends a notification directly, bypassing the event bus.
 *
 * Used for messages whose body is a credential — one-time codes and PIN resets. Those
 * must never travel as events, because every consumer of an exchange sees every field.
 *
 * Failure is logged, never thrown. A registration must not fail because the SMS gateway
 * is briefly down: the account exists, and the user can request another code. Throwing
 * here would turn a recoverable delivery problem into a lost signup.
 */
@Injectable()
export class NotifyClient {
  private readonly logger = new Logger(NotifyClient.name);

  constructor(private readonly options: NotifyOptions) {}

  async send(request: NotifyRequest): Promise<{ sent: boolean }> {
    try {
      const response = await fetch(
        `${this.options.notificationUrl}/internal/v1/notifications/send`,
        {
          method: 'POST',
          headers: internalHeaders(this.options.serviceName, this.options.internalSecret),
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(`Notification refused (${response.status}): ${detail}`);
        return { sent: false };
      }
      return { sent: true };
    } catch (error) {
      this.logger.error(
        `Notification unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { sent: false };
    }
  }
}

export const NOTIFY_OPTIONS = 'GOVSEC_NOTIFY_OPTIONS';
