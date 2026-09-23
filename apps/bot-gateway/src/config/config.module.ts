import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type BotGatewayConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): BotGatewayConfig => loadConfig() }],
  exports: [CONFIG],
})
export class BotGatewayConfigModule {}
