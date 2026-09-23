import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GovsecAuthModule, ServiceAuthGuard } from '@govsec/auth';
import { DEAD_LETTER_EXCHANGE, EXCHANGES } from '@govsec/events';
import { OutboxRelay, OUTBOX_OPTIONS, OUTBOX_STORE } from '@govsec/outbox';
import { CbsGatewayConfigModule } from '../config/config.module';
import { CONFIG, loadConfig, type CbsGatewayConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { CbsGatewayOutboxStore } from '../outbox/outbox.store';
import { PrismaModule } from '../prisma/prisma.module';

const bootConfig = loadConfig();

@Module({
  imports: [
    CbsGatewayConfigModule,
    PrismaModule,
    GovsecAuthModule.forRoot({
      accessTokenSecret: bootConfig.jwt.accessSecret,
      stepUpTokenSecret: bootConfig.jwt.stepUpSecret,
      algorithm: bootConfig.jwt.algorithm,
      issuer: bootConfig.jwt.issuer,
      audience: bootConfig.jwt.audience,
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (config: CbsGatewayConfig) => ({
        uri: config.rabbitmq.url,
        exchanges: [
          { name: EXCHANGES.cbs, type: 'topic', options: { durable: true } },
          { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        enableControllerDiscovery: true,
      }),
      inject: [CONFIG],
    }),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new ServiceAuthGuard(reflector, {
          serviceName: 'cbs-gateway',
          secret: bootConfig.internalSecret,
        }),
      inject: [Reflector],
    },
    CbsGatewayOutboxStore,
    { provide: OUTBOX_STORE, useExisting: CbsGatewayOutboxStore },
    {
      provide: OUTBOX_OPTIONS,
      useFactory: (config: CbsGatewayConfig) => ({
        exchange: EXCHANGES.cbs,
        pollIntervalMs: config.outbox.pollIntervalMs,
        batchSize: config.outbox.batchSize,
      }),
      inject: [CONFIG],
    },
    OutboxRelay,
  ],
})
export class AppModule {}
