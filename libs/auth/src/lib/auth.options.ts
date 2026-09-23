export const AUTH_OPTIONS = 'GOVSEC_AUTH_OPTIONS';

/**
 * What a service needs to *verify* GovSec tokens. Note there is no signing key here:
 * only Identity issues tokens. When these move to RS256 in production (TAD §10.1),
 * this becomes a public key and consuming services hold no signing material at all.
 */
export interface AuthModuleOptions {
  /**
   * Verification material for access tokens: an HS256 shared secret, or an RS256
   * public key in PEM form. Under RS256 this service cannot mint a token even if it
   * is fully compromised — which is the entire point of TAD §10.1.
   */
  accessTokenSecret: string;
  /** Same, for step-up tokens. */
  stepUpTokenSecret: string;
  /** Defaults to HS256 so development works without keys. Production requires RS256. */
  algorithm?: 'HS256' | 'RS256';
  issuer: string;
  audience: string;
}
