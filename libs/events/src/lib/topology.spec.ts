import {
  DEAD_LETTER_EXCHANGE,
  EXCHANGES,
  deadLetterQueueName,
  queueName,
  queueOptions,
} from './topology';

describe('RabbitMQ topology', () => {
  describe('queue naming', () => {
    it('gives each consumer of an exchange its own queue', () => {
      // If Settlement and Notification shared a queue, RabbitMQ would split auction
      // events between them rather than delivering every event to both. Each would
      // silently miss roughly half the stream.
      const settlement = queueName(EXCHANGES.auction, 'settlement');
      const notification = queueName(EXCHANGES.auction, 'notification');

      expect(settlement).not.toBe(notification);
      expect(settlement).toBe('govsec.auction.settlement.q');
      expect(notification).toBe('govsec.auction.notification.q');
    });

    it('gives one consumer a distinct queue per exchange it listens to', () => {
      expect(queueName(EXCHANGES.auction, 'notification')).not.toBe(
        queueName(EXCHANGES.settlement, 'notification'),
      );
    });

    it('pairs every queue with its own dead-letter queue', () => {
      expect(deadLetterQueueName(EXCHANGES.bot, 'auction')).toBe('govsec.bot.auction.dlq');
    });
  });

  describe('queue options', () => {
    const options = queueOptions(EXCHANGES.bot, 'auction');

    it('uses quorum queues', () => {
      // Classic mirrored queues are removed in RabbitMQ 4.x, and a financial event
      // must not sit on a non-replicated queue.
      expect(options.arguments['x-queue-type']).toBe('quorum');
    });

    it('is durable', () => {
      expect(options.durable).toBe(true);
    });

    it('dead-letters to the shared DLX with a per-queue routing key', () => {
      expect(options.arguments['x-dead-letter-exchange']).toBe(DEAD_LETTER_EXCHANGE);
      expect(options.arguments['x-dead-letter-routing-key']).toBe('govsec.bot.auction.dlq');
    });

    it('bounds redelivery instead of looping forever', () => {
      expect(options.arguments['x-delivery-limit']).toBeGreaterThan(0);
    });

    it('never sets a message TTL', () => {
      // An unconsumed allotment or settlement event must wait for its consumer to come
      // back, not quietly expire.
      expect(options.arguments).not.toHaveProperty('x-message-ttl');
      expect(options.arguments).not.toHaveProperty('x-expires');
    });
  });

  describe('exchanges', () => {
    it('namespaces every exchange', () => {
      for (const exchange of Object.values(EXCHANGES)) {
        expect(exchange.startsWith('govsec.')).toBe(true);
      }
    });

    it('has one exchange per publishing service', () => {
      expect(Object.keys(EXCHANGES).sort()).toEqual(
        ['auction', 'bot', 'cbs', 'identity', 'investor', 'settlement'].sort(),
      );
    });
  });
});
