import { Inject, Injectable, Logger } from '@nestjs/common';
import { StubSmsChannel } from '../channels/sms.channel';
import { CONFIG, type NotificationConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { isTemplateKey, render, type Locale } from '../templates/templates';

export type Category = 'security' | 'money' | 'auction' | 'account' | 'marketing';

export interface SendRequest {
  destination: string;
  templateKey: string;
  category: Category;
  variables: Record<string, string>;
  locale?: Locale;
}

/** "+255712345678" → "+255 712 •••678". Enough for support to recognise, not to reuse. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 9) return '•••';
  return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} •••${digits.slice(-3)}`;
}

/**
 * Renders, sends and records a message.
 *
 * The delivery log never holds the message body: an SMS here usually carries a
 * one-time code or a CDS account number. It records what was sent to whom (masked),
 * with which template, and how it went — enough to answer "did you send it?" without
 * storing the thing itself. Every outcome is recorded, including failure, because an
 * absent row is indistinguishable from a bug.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: StubSmsChannel,
    @Inject(CONFIG) private readonly config: NotificationConfig,
  ) {}

  async send(request: SendRequest): Promise<{ id: string; status: 'sent' | 'failed' }> {
    const locale = request.locale ?? 'sw';
    let status: 'sent' | 'failed' = 'failed';
    let providerRef: string | null = null;
    let error: string | null = null;

    if (!isTemplateKey(request.templateKey)) {
      error = `Unknown template "${request.templateKey}"`;
    } else {
      const body = render(request.templateKey, locale, request.variables);
      try {
        const result = await this.sms.send(request.destination, body);
        status = result.delivered ? 'sent' : 'failed';
        providerRef = result.providerRef ?? null;
        error = result.failureReason ?? null;
        if (this.config.logBodies) {
          // Development only: configuration refuses this in production, because bodies
          // carry live one-time codes.
          this.logger.warn(`[sms] → ${maskPhone(request.destination)}: ${body}`);
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }

    const row = await this.prisma.deliveryLog.create({
      data: {
        channel: 'sms',
        destinationMask: maskPhone(request.destination),
        templateKey: request.templateKey.slice(0, 100),
        category: request.category,
        status,
        providerRef,
        error: error?.slice(0, 500) ?? null,
      },
    });
    if (status === 'failed')
      this.logger.warn(`SMS ${row.id} (${request.templateKey}) failed: ${error}`);
    return { id: row.id, status };
  }
}
