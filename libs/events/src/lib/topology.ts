/**
 * RabbitMQ topology for the GovSec platform.
 *
 * TAD §7.5 was written for Kafka, where one topic is read independently by N consumer
 * groups. RabbitMQ has no such thing, so each Kafka topic becomes a *topic exchange*
 * and each consumer group becomes its own durable queue bound to it. Publishers know
 * only the exchange; adding a consumer means adding a queue and never touching the
 * producer.
 *
 * Queues are quorum queues: classic mirrored queues are removed in RabbitMQ 4.x, and
 * financial events cannot sit on a non-replicated queue.
 */

/**
 * One exchange per service that publishes domain events (TAD §7.5).
 *
 * `bot` carries what the Bank of Tanzania told us (auction published, bid accepted or
 * rejected, allotment received), translated by bot-gateway into our own vocabulary so
 * no other service ever parses a BoT payload. `cbs` does the same for Core Banking.
 */
export const EXCHANGES = {
  identity: 'govsec.identity',
  investor: 'govsec.investor',
  auction: 'govsec.auction',
  bot: 'govsec.bot',
  cbs: 'govsec.cbs',
  settlement: 'govsec.settlement',
} as const;

export type ExchangeName = (typeof EXCHANGES)[keyof typeof EXCHANGES];

/** Where messages go after exhausting their retries, for inspection and replay. */
export const DEAD_LETTER_EXCHANGE = 'govsec.dlx';

/**
 * Queue naming: <exchange>.<consuming service>.q
 *
 * The consumer's name is in the queue name because each consuming service needs its
 * own copy of the stream. Two services sharing a queue would split the messages
 * between them rather than each receiving all of them — the most common way a
 * Kafka-shaped design breaks when ported to RabbitMQ.
 */
export function queueName(exchange: ExchangeName, consumer: string): string {
  return `${exchange}.${consumer}.q`;
}

export function deadLetterQueueName(exchange: ExchangeName, consumer: string): string {
  return `${exchange}.${consumer}.dlq`;
}

/**
 * Standard arguments for a durable consumer queue.
 *
 * Note there is deliberately no message TTL: an unconsumed financial event must wait,
 * not expire. A lost settlement or allotment event is a reconciliation break.
 */
export function queueOptions(exchange: ExchangeName, consumer: string) {
  return {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
      'x-dead-letter-routing-key': deadLetterQueueName(exchange, consumer),
      // Park a message after 5 failed attempts instead of redelivering forever.
      'x-delivery-limit': 5,
    },
  } as const;
}
