import { Controller, HttpCode, Logger, Post, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@govsec/auth';
import { botTimestamp } from '@govsec/bot-client';
import type { Request, Response } from 'express';
import { CallbackService } from './callback.service';

/**
 * BoT's webhook: POST /bot/callback (spec §8).
 *
 * @Public because BoT holds no platform token. It is not open: CallbackService refuses
 * anything without a valid BoT signature over the exact bytes received, and the network
 * layer admits only BoT's source addresses (TAD §7.3). Hidden from Swagger, since no
 * one but BoT should call it.
 */
@ApiExcludeController()
@Controller('bot')
export class CallbackController {
  private readonly logger = new Logger(CallbackController.name);

  constructor(private readonly callbacks: CallbackService) {}

  @Public()
  @Post('callback')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const outcome = await this.callbacks.receive({
      pathAndQuery: req.originalUrl,
      rawBody: req.rawBody?.toString('utf8') ?? '',
      timestamp: header('x-timestamp'),
      signature: header('x-signature'),
    });

    const timestamp = botTimestamp();
    if (outcome.kind === 'rejected') {
      // A refused callback is either misconfiguration or someone who is not BoT.
      this.logger.warn(`Refused callback from ${req.ip}: ${outcome.code}`);
      res
        .status(outcome.status)
        .json({ status: 'error', code: outcome.code, message: outcome.message, timestamp });
      return;
    }
    res.status(200).json({
      status: 'acknowledged',
      message:
        outcome.kind === 'duplicate'
          ? 'Callback already received'
          : 'Callback event processed successfully',
      timestamp,
    });
  }
}
