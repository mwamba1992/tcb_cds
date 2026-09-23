import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type IdentityConfig } from './configuration';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): IdentityConfig => loadConfig() }],
  exports: [CONFIG],
})
export class IdentityConfigModule {}
