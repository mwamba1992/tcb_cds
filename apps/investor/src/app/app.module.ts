import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GovsecAuthModule, ServiceAuthGuard } from '@govsec/auth';
import { DEAD_LETTER_EXCHANGE, EXCHANGES } from '@govsec/events';
import { NotifyClient } from '@govsec/notify';
import { OutboxRelay, OUTBOX_OPTIONS, OUTBOX_STORE } from '@govsec/outbox';
import { NIDA_REGISTRY, StubNidaRegistry } from '../checks/nida';
import { SCREENING_LISTS, StubScreeningLists } from '../checks/screening';
import { CbsClient, IdentityClient } from '../clients/clients';
import { CbsEventsConsumer } from '../kyc/cbs-events.consumer';
import { CdsService } from '../kyc/cds.service';
import { DecisionsService } from '../kyc/decisions.service';
import { CdsController, KycController } from '../kyc/kyc.controller';
import { KycService } from '../kyc/kyc.service';
import { StatusNotifier } from '../notify/status-notifier';
import { OnboardingController } from '../onboarding/onboarding.controller';
import { OnboardingService } from '../onboarding/onboarding.service';
import { InvestorConfigModule } from '../config/config.module';
import { CONFIG, loadConfig, type InvestorConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { InvestorOutboxStore } from '../outbox/outbox.store';
import { PrismaModule } from '../prisma/prisma.module';

const bootConfig = loadConfig();

@Module({
  imports: [
    InvestorConfigModule,
    PrismaModule,
    GovsecAuthModule.forRoot({
      accessTokenSecret: bootConfig.jwt.accessSecret,
      stepUpTokenSecret: bootConfig.jwt.stepUpSecret,
      algorithm: bootConfig.jwt.algorithm,
      issuer: bootConfig.jwt.issuer,
      audience: bootConfig.jwt.audience,
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (config: InvestorConfig) => ({
        uri: config.rabbitmq.url,
        exchanges: [
          { name: EXCHANGES.investor, type: 'topic', options: { durable: true } },
          // Consumed, not published: declared here too so the binding never races
          // cbs-gateway's startup.
          { name: EXCHANGES.cbs, type: 'topic', options: { durable: true } },
          { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        enableControllerDiscovery: true,
      }),
      inject: [CONFIG],
    }),
  ],
  controllers: [HealthController, OnboardingController, KycController, CdsController],
  providers: [
    IdentityClient,
    CbsClient,
    {
      provide: NotifyClient,
      useFactory: (config: InvestorConfig) =>
        new NotifyClient({
          notificationUrl: config.services.notificationUrl,
          internalSecret: config.internalSecret,
          serviceName: 'investor',
        }),
      inject: [CONFIG],
    },
    // Stand-ins until TCB's NIDA and screening subscriptions are connected;
    // loadConfig() refuses production with either still stubbed.
    {
      provide: NIDA_REGISTRY,
      useFactory: (config: InvestorConfig) => {
        if (config.nidaMode === 'live') throw new Error('NIDA_MODE=live: no NIDA adapter exists yet');
        return new StubNidaRegistry();
      },
      inject: [CONFIG],
    },
    {
      provide: SCREENING_LISTS,
      useFactory: (config: InvestorConfig) => {
        if (config.screeningMode === 'live') throw new Error('SCREENING_MODE=live: no screening adapter exists yet');
        return new StubScreeningLists();
      },
      inject: [CONFIG],
    },
    StatusNotifier,
    DecisionsService,
    OnboardingService,
    KycService,
    CdsService,
    CbsEventsConsumer,
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new ServiceAuthGuard(reflector, {
          serviceName: 'investor',
          secret: bootConfig.internalSecret,
        }),
      inject: [Reflector],
    },
    InvestorOutboxStore,
    { provide: OUTBOX_STORE, useExisting: InvestorOutboxStore },
    {
      provide: OUTBOX_OPTIONS,
      useFactory: (config: InvestorConfig) => ({
        exchange: EXCHANGES.investor,
        pollIntervalMs: config.outbox.pollIntervalMs,
        batchSize: config.outbox.batchSize,
      }),
      inject: [CONFIG],
    },
    OutboxRelay,
  ],
})
export class AppModule {}
