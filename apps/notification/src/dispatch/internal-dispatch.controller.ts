import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly, Public } from '@govsec/auth';
import { IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import { DispatchService, type Category } from './dispatch.service';

class SendDto {
  @Matches(/^\+255\d{9}$/, { message: 'destination must be a Tanzanian mobile number, +255…' })
  destination!: string;

  @IsString()
  @Length(1, 80)
  templateKey!: string;

  @IsIn(['security', 'money', 'auction', 'account', 'marketing'])
  category!: string;

  @IsObject()
  variables!: Record<string, string>;

  @IsOptional()
  @IsIn(['en', 'sw'])
  locale?: 'en' | 'sw';
}

/**
 * Direct send, for messages that must not travel as events.
 *
 * A one-time code cannot go in an event: every consumer of an exchange sees every
 * field, so publishing an OTP would hand a live credential to every service bound to
 * it. Credentials are sent by a direct, authenticated call from the service that
 * minted them.
 */
@ApiExcludeController()
@Controller('internal/v1/notifications')
export class InternalDispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Public()
  @InternalOnly('identity', 'investor', 'auction', 'settlement')
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  async send(@Body() dto: SendDto) {
    const result = await this.dispatch.send({
      destination: dto.destination,
      templateKey: dto.templateKey,
      category: dto.category as Category,
      variables: dto.variables,
      locale: dto.locale,
    });
    return { notificationId: result.id, status: result.status };
  }
}
