/**
 * A setting's definition lives in code; only its *value* lives in the database.
 *
 * That split is the point. Adding a setting is a reviewed change — someone has to think
 * about its bounds, its type, and whether an operator should be able to touch it at all.
 * Tuning one is not. If both lived in the database, a settings screen would become a way
 * to invent new configuration that nothing reads.
 */

export type SettingType = 'money' | 'integer' | 'boolean' | 'string';

export interface SettingDefinition<T = unknown> {
  /** Stable key, e.g. `bid.minimum.amount`. Never renamed once shipped. */
  key: string;
  type: SettingType;
  /** Used when no row exists. Every setting works before anyone has configured it. */
  fallback: T;
  /** Grouping for the operator's screen. */
  category: string;
  /** Shown to the operator. Write it for them, not for the developer. */
  description: string;
  /**
   * Bounds, enforced at write time.
   *
   * A settings system without bounds is a way to break production from a web form. A
   * minimum bid of -1 or 100,000,000,000 must be refused by the definition, not
   * discovered by an investor.
   *
   * For `money` these are minor units; for `integer`, the number itself.
   */
  min?: bigint | number;
  max?: bigint | number;
  /** One of a fixed set, for `string`. */
  options?: readonly string[];
  /**
   * False for values that exist in the table for visibility but must not be changed
   * from a screen. Rare — if it is not editable, ask whether it should be a setting.
   */
  editable?: boolean;
}

export class SettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingError';
  }
}

/**
 * Parse a stored string into the declared type.
 *
 * Everything is stored as text: money must be a string anyway (a JSON number is a
 * double), and one column beats a column per type. The definition is what knows how to
 * read it back.
 */
export function parseSetting<T>(definition: SettingDefinition<T>, raw: string): T {
  switch (definition.type) {
    case 'money': {
      if (!/^-?\d+$/.test(raw)) {
        throw new SettingError(`${definition.key}: expected whole minor units, got "${raw}"`);
      }
      return BigInt(raw) as unknown as T;
    }
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) {
        throw new SettingError(`${definition.key}: expected an integer, got "${raw}"`);
      }
      return Number(raw) as unknown as T;
    }
    case 'boolean':
      return (raw === 'true') as unknown as T;
    case 'string':
      return raw as unknown as T;
    default:
      throw new SettingError(`${definition.key}: unknown type`);
  }
}

/** Render a value for storage. Money stays exact by going through bigint, never a float. */
export function serialiseSetting<T>(definition: SettingDefinition<T>, value: T): string {
  if (definition.type === 'money') return (value as bigint).toString();
  if (definition.type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Validate a proposed value against its definition.
 *
 * Throws rather than returning a boolean: a caller can ignore a boolean, and this is the
 * only thing standing between a typo and a platform-wide price change.
 */
export function validateSetting<T>(definition: SettingDefinition<T>, value: T): void {
  if (definition.editable === false) {
    throw new SettingError(`${definition.key} is not editable`);
  }

  if (definition.type === 'money' || definition.type === 'integer') {
    const numeric = definition.type === 'money' ? (value as bigint) : BigInt(value as number);
    if (definition.min !== undefined && numeric < BigInt(definition.min)) {
      throw new SettingError(
        `${definition.key} must be at least ${definition.min}, got ${numeric}`,
      );
    }
    if (definition.max !== undefined && numeric > BigInt(definition.max)) {
      throw new SettingError(`${definition.key} must be at most ${definition.max}, got ${numeric}`);
    }
  }

  if (definition.type === 'string' && definition.options) {
    if (!definition.options.includes(value as unknown as string)) {
      throw new SettingError(`${definition.key} must be one of: ${definition.options.join(', ')}`);
    }
  }
}
