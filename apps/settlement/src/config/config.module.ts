import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type SettlementConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): SettlementConfig => loadConfig() }],
  exports: [CONFIG],
})
export class SettlementConfigModule {}
