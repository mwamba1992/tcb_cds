import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { BOT_EVENTS, EXCHANGES, queueName, queueOptions, type BotAuctionPayload, type EventEnvelope } from '@govsec/events';
import { CatalogueService } from './catalogue.service';

/** Keeps the catalogue in step with BoT. An upsert, so redelivery is harmless. */
@Injectable()
export class BotAuctionsConsumer {
  constructor(private readonly catalogue: CatalogueService) {}

  @RabbitSubscribe({
    exchange: EXCHANGES.bot,
    routingKey: [BOT_EVENTS.auctionPublished, BOT_EVENTS.auctionUpdated],
    queue: queueName(EXCHANGES.bot, 'auction-catalogue'),
    queueOptions: queueOptions(EXCHANGES.bot, 'auction-catalogue'),
  })
  async onAuction(envelope: EventEnvelope<BotAuctionPayload>): Promise<void> {
    await this.catalogue.upsertFromBot(envelope.payload);
  }
}
