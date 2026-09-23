import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { CONFIG, type BotGatewayConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Keeps the untouched request bytes. BoT signs callbacks over the exact body it
    // sent; verifying over a re-serialised body would fail, because JSON.stringify
    // reorders nothing but also preserves none of the sender's whitespace.
    rawBody: true,
  });
  const config = app.get<BotGatewayConfig>(CONFIG);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  if (config.nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('GovSec — BoT Gateway')
        .setDescription(
          'The only service that talks to the Bank of Tanzania GSS API: signing, tokens, bids, winners, callbacks (TAD §7.3). ' +
            'All amounts are decimal strings, never JSON numbers.',
        )
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
  Logger.log(`BoT Gateway service listening on http://localhost:${config.port}`, 'Bootstrap');
}

void bootstrap();
