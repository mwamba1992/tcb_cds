import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import {
  CBS_EVENTS,
  EXCHANGES,
  queueName,
  queueOptions,
  type CbsAccountOpenedPayload,
  type EventEnvelope,
} from '@govsec/events';
import { DecisionsService } from './decisions.service';

/**
 * Core Banking telling us a new-to-bank investor's account is open. Safe to receive
 * twice: linking the same account again changes nothing.
 */
@Injectable()
export class CbsEventsConsumer {
  constructor(private readonly decisions: DecisionsService) {}

  @RabbitSubscribe({
    exchange: EXCHANGES.cbs,
    routingKey: CBS_EVENTS.accountOpened,
    queue: queueName(EXCHANGES.cbs, 'investor'),
    queueOptions: queueOptions(EXCHANGES.cbs, 'investor'),
  })
  async onAccountOpened(envelope: EventEnvelope<CbsAccountOpenedPayload>): Promise<void> {
    await this.decisions.linkOpenedAccount({
      investorId: envelope.payload.investorId,
      customerId: envelope.payload.customerId,
      accountNumber: envelope.payload.accountNumber,
    });
  }
}
