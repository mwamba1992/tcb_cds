import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { CONFIG, type CbsGatewayConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<CbsGatewayConfig>(CONFIG);

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
        .setTitle('GovSec — Core Banking Gateway')
        .setDescription(
          'The only service that talks to TCB Core Banking: account lookup, holds, debits, GL postings (TAD §7.2). ' +
            'All amounts are decimal strings, never JSON numbers.',
        )
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
  Logger.log(
    `Core Banking Gateway service listening on http://localhost:${config.port}`,
    'Bootstrap',
  );
}

void bootstrap();
