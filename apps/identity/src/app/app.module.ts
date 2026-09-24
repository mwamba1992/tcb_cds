import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GovsecAuthModule, ServiceAuthGuard } from '@govsec/auth';
import { DEAD_LETTER_EXCHANGE, EXCHANGES } from '@govsec/events';
import { NotifyClient } from '@govsec/notify';
import { OutboxRelay, OUTBOX_OPTIONS, OUTBOX_STORE } from '@govsec/outbox';
import { CustomerLoginsController, StaffAdminController } from '../admin/admin.controller';
import { CustomerLoginsService } from '../admin/customer-logins.service';
import { StaffAdminService } from '../admin/staff-admin.service';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { InternalController } from '../auth/internal.controller';
import { OtpService } from '../auth/otp.service';
import { PinService } from '../auth/pin.service';
import { SecretHasher } from '../auth/secret-hasher';
import { SessionService } from '../auth/session.service';
import { StaffAuthService } from '../auth/staff-auth.service';
import { StepUpService } from '../auth/step-up.service';
import { TokenService } from '../auth/token.service';
import { IdentityConfigModule } from '../config/config.module';
import { CONFIG, loadConfig, type IdentityConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { IdentityOutboxStore } from '../outbox/outbox.store';
import { PrismaModule } from '../prisma/prisma.module';

const bootConfig = loadConfig();

@Module({
  imports: [
    IdentityConfigModule,
    PrismaModule,
    GovsecAuthModule.forRoot({
      accessTokenSecret: bootConfig.jwt.accessSecret,
      stepUpTokenSecret: bootConfig.jwt.stepUpSecret,
      algorithm: bootConfig.jwt.algorithm,
      issuer: bootConfig.jwt.issuer,
      audience: bootConfig.jwt.audience,
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (config: IdentityConfig) => ({
        uri: config.rabbitmq.url,
        exchanges: [
          { name: EXCHANGES.identity, type: 'topic', options: { durable: true } },
          { name: DEAD_LETTER_EXCHANGE, type: 'topic', options: { durable: true } },
        ],
        connectionInitOptions: { wait: true, timeout: 10_000 },
        enableControllerDiscovery: true,
      }),
      inject: [CONFIG],
    }),
  ],
  controllers: [HealthController, AuthController, InternalController, StaffAdminController, CustomerLoginsController],
  providers: [
    SecretHasher,
    TokenService,
    SessionService,
    OtpService,
    PinService,
    AuthService,
    StepUpService,
    StaffAuthService,
    StaffAdminService,
    CustomerLoginsService,
    {
      provide: NotifyClient,
      useFactory: (config: IdentityConfig) =>
        new NotifyClient({
          notificationUrl: config.notificationUrl,
          internalSecret: config.internalSecret,
          serviceName: 'identity',
        }),
      inject: [CONFIG],
    },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new ServiceAuthGuard(reflector, {
          serviceName: 'identity',
          secret: bootConfig.internalSecret,
        }),
      inject: [Reflector],
    },
    IdentityOutboxStore,
    { provide: OUTBOX_STORE, useExisting: IdentityOutboxStore },
    {
      provide: OUTBOX_OPTIONS,
      useFactory: (config: IdentityConfig) => ({
        exchange: EXCHANGES.identity,
        pollIntervalMs: config.outbox.pollIntervalMs,
        batchSize: config.outbox.batchSize,
      }),
      inject: [CONFIG],
    },
    OutboxRelay,
  ],
})
export class AppModule {}
