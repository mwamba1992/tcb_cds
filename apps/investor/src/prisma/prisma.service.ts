import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { CONFIG, type InvestorConfig } from '../config/configuration';

const DEFAULT_SCHEMA = 'investor';

export function schemaFromUrl(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).searchParams.get('schema') ?? DEFAULT_SCHEMA;
  } catch {
    return DEFAULT_SCHEMA;
  }
}

/**
 * Both `schema` and `search_path` are set: the first qualifies generated queries, the
 * second makes $queryRaw resolve unqualified names. Setting only one leaves every raw
 * statement looking in `public`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly schema: string;

  constructor(@Inject(CONFIG) config: InvestorConfig) {
    const schema = schemaFromUrl(config.databaseUrl);
    super({
      adapter: new PrismaPg(
        {
          connectionString: config.databaseUrl,
          // timezone=UTC is not optional. The pg driver renders timestamptz in the
          // session timezone and hands Node a string with no offset, which becomes a Date
          // read as UTC. On a +03 server every timestamp would then be three hours out —
          // including auction cut-offs.
          options: `-c search_path=${schema} -c timezone=UTC`,
        },
        { schema },
      ),
    });
    this.schema = schema;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Connected to schema "${this.schema}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
