import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import {
  BOT_EVENTS,
  EXCHANGES,
  queueName,
  queueOptions,
  type BotBatchReconciledPayload,
  type BotBidOutcomePayload,
  type EventEnvelope,
} from '@govsec/events';
import { ResultsService } from './results.service';

const OUTCOME: Record<string, 'accepted' | 'rejected' | 'allotted' | 'unsuccessful'> = {
  [BOT_EVENTS.bidAccepted]: 'accepted',
  [BOT_EVENTS.bidRejected]: 'rejected',
  [BOT_EVENTS.bidAllotted]: 'allotted',
  [BOT_EVENTS.bidUnsuccessful]: 'unsuccessful',
};

/**
 * BoT's word on our batches and bids, from bot-gateway. One queue: outcomes and
 * reconciliations are processed in the order bot-gateway published them.
 */
@Injectable()
export class BotResultsConsumer {
  constructor(private readonly results: ResultsService) {}

  @RabbitSubscribe({
    exchange: EXCHANGES.bot,
    routingKey: [BOT_EVENTS.batchReconciled, ...Object.keys(OUTCOME)],
    queue: queueName(EXCHANGES.bot, 'auction-results'),
    queueOptions: queueOptions(EXCHANGES.bot, 'auction-results'),
  })
  async onEvent(envelope: EventEnvelope<unknown>): Promise<void> {
    if (envelope.eventType === BOT_EVENTS.batchReconciled) {
      await this.results.onReconciled(envelope.payload as BotBatchReconciledPayload);
      return;
    }
    const outcome = OUTCOME[envelope.eventType];
    if (outcome) await this.results.onOutcome(envelope.idempotencyKey, outcome, envelope.payload as BotBidOutcomePayload);
  }
}
