import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { BotSimulator } from '@govsec/bot-simulator';

/**
 * Runs the BoT simulator as a local service (development only).
 *
 * TCB is registered as the one participant, using the same BOT_* values bot-gateway
 * reads, so pointing bot-gateway at http://localhost:3199 just works. Keys come from
 * ./secrets — run scripts/dev-bot-keys.sh once to create them.
 *
 *   GET  /_sim/state                       what the simulator holds
 *   POST /_sim/close {isin, cutoffPrice}   run an auction and send callbacks
 */
const logger = new Logger('BotSimulator');

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

function readKey(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    logger.error(`Cannot read ${what} at ${path}. Run scripts/dev-bot-keys.sh first.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    logger.error('The BoT simulator must never run in production.');
    process.exit(1);
  }
  const port = Number(env('BOT_SIM_PORT', '3199'));
  const simulator = new BotSimulator({
    botPrivateKeyPem: readKey(
      env('BOT_SIM_PRIVATE_KEY_PATH', './secrets/bot-sim-private.pem'),
      'the simulator private key',
    ),
    participants: [
      {
        displayName: 'TANZANIA COMMERCIAL BANK',
        username: env('BOT_USERNAME', 'TCB'),
        senderCode: env('BOT_SENDER_CODE', 'TCB_TZ'),
        interfaceCode: env('BOT_INTERFACE_CODE', 'BOT-I-GSS-099'),
        apiKey: env('BOT_API_KEY', 'sim-api-key'),
        participantCode: env('BOT_PARTICIPANT_CODE', 'TCBGSP01'),
        publicKeyPem: readKey(
          env('BOT_SIM_PARTICIPANT_PUBLIC_KEY_PATH', './secrets/tcb-bot-public.pem'),
          "TCB's public key",
        ),
        callbackUrl: env('BOT_SIM_CALLBACK_URL', 'http://localhost:3104/bot/callback'),
      },
    ],
    log: (message) => logger.warn(message),
  });
  const url = await simulator.start(port, 'localhost');
  logger.log(`BoT simulator listening on ${url}`);
  for (const a of simulator.auctions) {
    logger.log(`  ${a.ISIN}  ${a.securityName.padEnd(24)} cut-off ${a.cutoffAt.toISOString()}`);
  }
  const shutdown = () => void simulator.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
