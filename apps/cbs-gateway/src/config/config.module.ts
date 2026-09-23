import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type CbsGatewayConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): CbsGatewayConfig => loadConfig() }],
  exports: [CONFIG],
})
export class CbsGatewayConfigModule {}
