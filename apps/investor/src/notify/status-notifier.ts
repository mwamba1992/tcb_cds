import { Injectable, Logger } from '@nestjs/common';
import { NotifyClient } from '@govsec/notify';
import { IdentityClient } from '../clients/clients';

export type StatusTemplate =
  | 'onboarding.submitted'
  | 'kyc.under_review'
  | 'kyc.approved'
  | 'kyc.rejected'
  | 'cds.opened';

/**
 * Tells the investor where their application stands, by SMS.
 *
 * The phone number is fetched from identity at send time rather than copied here:
 * identity owns it, and a copy would go stale the day the customer changes number.
 * Never throws — a status message that fails to send must not undo a KYC decision.
 */
@Injectable()
export class StatusNotifier {
  private readonly logger = new Logger(StatusNotifier.name);

  constructor(
    private readonly identity: IdentityClient,
    private readonly notify: NotifyClient,
  ) {}

  async send(accountId: string, templateKey: StatusTemplate, variables: Record<string, string>): Promise<void> {
    try {
      const contact = await this.identity.contact(accountId);
      await this.notify.send({
        destination: contact.phoneNumber,
        templateKey,
        category: 'account',
        locale: contact.locale,
        variables,
      });
    } catch (error) {
      this.logger.error(
        `Could not send ${templateKey} to account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
