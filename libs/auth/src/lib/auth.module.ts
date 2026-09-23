import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StepUpGuard } from './step-up.guard';

/**
 * Wires token verification into a service.
 *
 * Both guards register as APP_GUARD, so protection is the default and each new
 * endpoint has to opt out via @Public() rather than opt in. Guard order matters:
 * JwtAuthGuard runs first and populates request.user, which StepUpGuard then
 * compares the grant's subject against.
 */
@Module({})
export class GovsecAuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: GovsecAuthModule,
      global: true,
      imports: [JwtModule.register({})],
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: StepUpGuard },
      ],
      exports: [AUTH_OPTIONS, JwtModule],
    };
  }
}
