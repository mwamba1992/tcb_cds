import { Injectable, Logger } from '@nestjs/common';
import {
  parseSetting,
  serialiseSetting,
  validateSetting,
  type SettingDefinition,
} from './definition';

/**
 * The per-service storage each app implements over its own settings tables.
 *
 * A port rather than a shared table, because database-per-service holds here as
 * everywhere else (TAD §9.2): an auction cut-off guard belongs to Auction the way a
 * KYC limit belongs to Investor.
 */
export interface SettingsStore {
  read(key: string): Promise<string | null>;
  readAll(): Promise<Map<string, { value: string; updatedBy: string | null; updatedAt: Date }>>;
  write(input: {
    key: string;
    value: string;
    previous: string | null;
    changedBy: string;
    reason: string;
  }): Promise<void>;
  history(
    key: string,
    limit: number,
  ): Promise<
    Array<{
      oldValue: string | null;
      newValue: string;
      changedBy: string;
      reason: string;
      at: Date;
    }>
  >;
}

export const SETTINGS_STORE = 'GOVSEC_SETTINGS_STORE';
export const SETTINGS_DEFINITIONS = 'GOVSEC_SETTINGS_DEFINITIONS';

/** How long a read stays cached. Settings change monthly and are read constantly. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { value: unknown; expires: number }>();

  constructor(
    private readonly store: SettingsStore,
    private readonly definitions: readonly SettingDefinition<never>[],
  ) {}

  /**
   * Read a setting, falling back to its declared default.
   *
   * Never throws for a missing row: every setting works before anyone has configured it,
   * so a fresh environment behaves sensibly rather than failing at the first checkout.
   * A *malformed* row does throw — that means someone wrote something the definition
   * cannot read, and silently substituting a default would hide it.
   */
  async get<T>(definition: SettingDefinition<T>): Promise<T> {
    const cached = this.cache.get(definition.key);
    if (cached && cached.expires > Date.now()) return cached.value as T;

    const raw = await this.store.read(definition.key);
    const value = raw === null ? definition.fallback : parseSetting(definition, raw);

    this.cache.set(definition.key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /**
   * Change a setting.
   *
   * Validated against the definition before anything is written, and recorded with who
   * changed it and why — the same standard as every other consequential action in the
   * platform (standards §2.6).
   */
  async set<T>(
    definition: SettingDefinition<T>,
    value: T,
    changedBy: string,
    reason: string,
  ): Promise<T> {
    if (!reason?.trim()) {
      throw new Error(`Changing ${definition.key} requires a reason`);
    }
    validateSetting(definition, value);

    const previous = await this.store.read(definition.key);
    const serialised = serialiseSetting(definition, value);

    await this.store.write({
      key: definition.key,
      value: serialised,
      previous,
      changedBy,
      reason: reason.slice(0, 255),
    });

    // Invalidated rather than updated: the write may have been rejected by a constraint
    // we do not know about, and a cache holding a value the database refused is worse
    // than a cache miss.
    this.cache.delete(definition.key);

    this.logger.warn(
      `SETTING_CHANGED key=${definition.key} from=${previous ?? '(default)'} ` +
        `to=${serialised} by=${changedBy} reason="${reason}"`,
    );
    return value;
  }

  /** Everything an operator can see, with current values and provenance. */
  async list() {
    const stored = await this.store.readAll();

    return this.definitions.map((definition) => {
      const row = stored.get(definition.key);
      return {
        key: definition.key,
        category: definition.category,
        description: definition.description,
        type: definition.type,
        // Rendered as strings throughout: money must never be a JSON number, and one
        // shape for every type keeps the client simple.
        value: row?.value ?? serialiseSetting(definition, definition.fallback),
        default_value: serialiseSetting(definition, definition.fallback),
        is_default: row === undefined,
        min: definition.min?.toString() ?? null,
        max: definition.max?.toString() ?? null,
        options: definition.options ?? null,
        editable: definition.editable !== false,
        updated_by: row?.updatedBy ?? null,
        updated_at: row?.updatedAt?.toISOString() ?? null,
      };
    });
  }

  find(key: string): SettingDefinition<never> | undefined {
    return this.definitions.find((definition) => definition.key === key);
  }

  async history(key: string, limit = 20) {
    const rows = await this.store.history(key, limit);
    return rows.map((row) => ({
      old_value: row.oldValue,
      new_value: row.newValue,
      changed_by: row.changedBy,
      reason: row.reason,
      at: row.at.toISOString(),
    }));
  }

  /** For tests and for an operator who has just changed something elsewhere. */
  clearCache(): void {
    this.cache.clear();
  }
}
