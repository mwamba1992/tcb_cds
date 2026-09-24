import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GovsecAuthModule, ServiceAuthGuard } from '@govsec/auth';
import { DEAD_LETTER_EXCHANGE, EXCHANGES } from '@govsec/events';
import { OutboxRelay, OUTBOX_OPTIONS, OUTBOX_STORE } from '@govsec/outbox';
import { readFileSync } from 'node:fs';
import { AuctionSyncScheduler } from '../auctions/auction-sync.scheduler';
import { AuctionSyncService } from '../auctions/auction-sync.service';
import { PrismaSnapshotStore } from '../auctions/prisma-snapshot.store';
import { BatchController } from '../batches/batch.controller';
import { BidsController } from '../bids/bids.controller';
import { BatchSubmissionService } from '../batches/batch-submission.service';
import { PrismaSubmissionStore } from '../batches/prisma-submission.store';
import { botHealthProvider, botServiceProvider } from '../bot/bot.providers';
import { PrismaAuditWriter } from '../bot/prisma-audit.writer';
import { BotService } from '../bot/bot.service';
import { CallbackController } from '../callbacks/callback.controller';
import { CallbackService } from '../callbacks/callback.service';
import { PrismaCallbackStore } from '../callbacks/prisma-callback.store';
import { BotGatewayConfigModule } from '../config/config.module';
import { CONFIG, loadConfig, type BotGatewayConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { BotGatewayOutboxStore } from '../outbox/outbox.store';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaReconcileStore } from '../reconciliation/prisma-reconcile.store';
import { PrismaWinnersStore } from '../reconciliation/prisma-winners.store';
import { ReconciliationScheduler } from '../reconciliation/reconciliation.scheduler';
import { SubmissionReconciler } from '../reconciliation/submission-reconciler';
import { WinnersCheck } from '../reconciliation/winners-check';

const bootConfig = loadConfig();

/** BoT's public key for callbacks; absent in development without keys (callbacks then 503). */
function readBotPublicKey(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

@Module({
  imports: [
    BotGatewayConfigModule,
    PrismaModule,
    GovsecAuthModule.forRoot({
      accessTokenSecret: bootConfig.jwt.accessSecret,
      stepUpTokenSecret: bootConfig.jwt.stepUpSecret,
      algorithm: bootConfig.jwt.algorithm,
      issuer: bootConfig.jwt.issuer,
      audience: bootConfig.jwt.audience,
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (config: BotGatewayConfig) => ({
        uri: config.rabbitmq.url,
        exchanges: [
          { name: EXCHANGES.bot, type: 'topic', options: { durable: true } },
          { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        enableControllerDiscovery: true,
      }),
      inject: [CONFIG],
    }),
  ],
  controllers: [HealthController, CallbackController, BatchController, BidsController],
  providers: [
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new ServiceAuthGuard(reflector, {
          serviceName: 'bot-gateway',
          secret: bootConfig.internalSecret,
        }),
      inject: [Reflector],
    },
    botHealthProvider,
    PrismaAuditWriter,
    botServiceProvider,
    PrismaCallbackStore,
    {
      provide: CallbackService,
      useFactory: (store: PrismaCallbackStore, config: BotGatewayConfig) =>
        new CallbackService(store, readBotPublicKey(config.bot.botPublicKeyPath)),
      inject: [PrismaCallbackStore, CONFIG],
    },
    PrismaSnapshotStore,
    {
      provide: AuctionSyncService,
      useFactory: (bot: BotService, store: PrismaSnapshotStore) =>
        new AuctionSyncService(bot, store),
      inject: [BotService, PrismaSnapshotStore],
    },
    AuctionSyncScheduler,
    PrismaSubmissionStore,
    PrismaReconcileStore,
    {
      provide: SubmissionReconciler,
      useFactory: (bot: BotService, store: PrismaReconcileStore) =>
        new SubmissionReconciler(bot, store),
      inject: [BotService, PrismaReconcileStore],
    },
    PrismaWinnersStore,
    {
      provide: WinnersCheck,
      useFactory: (bot: BotService, store: PrismaWinnersStore, config: BotGatewayConfig) =>
        new WinnersCheck(bot, store, config.bot.investorName),
      inject: [BotService, PrismaWinnersStore, CONFIG],
    },
    ReconciliationScheduler,
    {
      provide: BatchSubmissionService,
      useFactory: (bot: BotService, store: PrismaSubmissionStore) =>
        new BatchSubmissionService(bot, store),
      inject: [BotService, PrismaSubmissionStore],
    },
    BotGatewayOutboxStore,
    { provide: OUTBOX_STORE, useExisting: BotGatewayOutboxStore },
    {
      provide: OUTBOX_OPTIONS,
      useFactory: (config: BotGatewayConfig) => ({
        exchange: EXCHANGES.bot,
        pollIntervalMs: config.outbox.pollIntervalMs,
        batchSize: config.outbox.batchSize,
      }),
      inject: [CONFIG],
    },
    OutboxRelay,
  ],
})
export class AppModule {}
