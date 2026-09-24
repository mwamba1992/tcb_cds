import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GovsecAuthModule, ServiceAuthGuard } from '@govsec/auth';
import { DEAD_LETTER_EXCHANGE, EXCHANGES } from '@govsec/events';
import { NotifyClient } from '@govsec/notify';
import { OutboxRelay, OUTBOX_OPTIONS, OUTBOX_STORE } from '@govsec/outbox';
import { StaffAuctionsController } from '../batches/batches.controller';
import { BatchesService } from '../batches/batches.service';
import { InvestorAuctionsController } from '../bids/bids.controller';
import { BidsService } from '../bids/bids.service';
import { BotAuctionsConsumer } from '../catalogue/bot-auctions.consumer';
import { CatalogueRefresher } from '../catalogue/catalogue.refresher';
import { CatalogueService } from '../catalogue/catalogue.service';
import { Neighbours } from '../clients/clients';
import { BotResultsConsumer } from '../results/bot-results.consumer';
import { ResultsService } from '../results/results.service';
import { AuctionConfigModule } from '../config/config.module';
import { CONFIG, loadConfig, type AuctionConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { AuctionOutboxStore } from '../outbox/outbox.store';
import { PrismaModule } from '../prisma/prisma.module';

const bootConfig = loadConfig();

@Module({
  imports: [
    AuctionConfigModule,
    PrismaModule,
    GovsecAuthModule.forRoot({
      accessTokenSecret: bootConfig.jwt.accessSecret,
      stepUpTokenSecret: bootConfig.jwt.stepUpSecret,
      algorithm: bootConfig.jwt.algorithm,
      issuer: bootConfig.jwt.issuer,
      audience: bootConfig.jwt.audience,
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (config: AuctionConfig) => ({
        uri: config.rabbitmq.url,
        exchanges: [
          { name: EXCHANGES.auction, type: 'topic', options: { durable: true } },
          // Consumed: declared here too so bindings never race bot-gateway's startup.
          { name: EXCHANGES.bot, type: 'topic', options: { durable: true } },
          { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        enableControllerDiscovery: true,
      }),
      inject: [CONFIG],
    }),
  ],
  controllers: [HealthController, InvestorAuctionsController, StaffAuctionsController],
  providers: [
    Neighbours,
    {
      provide: NotifyClient,
      useFactory: (config: AuctionConfig) =>
        new NotifyClient({
          notificationUrl: config.services.notificationUrl,
          internalSecret: config.internalSecret,
          serviceName: 'auction',
        }),
      inject: [CONFIG],
    },
    CatalogueService,
    CatalogueRefresher,
    BidsService,
    BatchesService,
    ResultsService,
    BotAuctionsConsumer,
    BotResultsConsumer,
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new ServiceAuthGuard(reflector, {
          serviceName: 'auction',
          secret: bootConfig.internalSecret,
        }),
      inject: [Reflector],
    },
    AuctionOutboxStore,
    { provide: OUTBOX_STORE, useExisting: AuctionOutboxStore },
    {
      provide: OUTBOX_OPTIONS,
      useFactory: (config: AuctionConfig) => ({
        exchange: EXCHANGES.auction,
        pollIntervalMs: config.outbox.pollIntervalMs,
        batchSize: config.outbox.batchSize,
      }),
      inject: [CONFIG],
    },
    OutboxRelay,
  ],
})
export class AppModule {}
