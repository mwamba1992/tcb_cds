import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type AuctionConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): AuctionConfig => loadConfig() }],
  exports: [CONFIG],
})
export class AuctionConfigModule {}
