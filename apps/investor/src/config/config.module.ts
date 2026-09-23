import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type InvestorConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): InvestorConfig => loadConfig() }],
  exports: [CONFIG],
})
export class InvestorConfigModule {}
