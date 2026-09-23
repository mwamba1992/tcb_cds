import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type NotificationConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): NotificationConfig => loadConfig() }],
  exports: [CONFIG],
})
export class NotificationConfigModule {}
