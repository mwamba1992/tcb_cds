// Prisma CLI configuration for the bot-gateway service (TAD §9.2).
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.BOT_GATEWAY_DATABASE_URL },
});
