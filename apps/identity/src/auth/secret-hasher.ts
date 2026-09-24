import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id for the two short secrets this service stores: PINs and OTP codes.
 *
 * A 4-digit PIN has 10,000 values, so no hash makes a stolen pin_hash column safe on
 * its own; argon2id makes each guess cost ~19 MiB and tens of milliseconds, which
 * turns a leak into hours of work per account rather than a lookup table.
 */
@Injectable()
export class SecretHasher {
  // OWASP's second-recommended Argon2id profile: 19 MiB, 2 iterations, 1 lane.
  private readonly options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, this.options);
  }

  /** False, not an exception, on a malformed stored hash: it reads as a wrong secret. */
  async verify(hashed: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(hashed, plaintext);
    } catch {
      return false;
    }
  }
}
