import { request } from './http';

/** Identity and investor endpoints the sign-in and onboarding screens use. */

export interface CodeSent {
  expiresAt: string;
  resendAfter: string;
}

export interface Tokens {
  accountId: string;
  role: string;
  pinSet: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface Me {
  accountId: string;
  phoneNumber: string;
  role: string;
  locale: 'sw' | 'en';
  pinSet: boolean;
  permissions: string[];
}

export type NextStep =
  | 'profile'
  | 'submit'
  | 'under_review'
  | 'provide_info'
  | 'awaiting_cds'
  | 'ready'
  | 'rejected';

export interface IndividualProfile {
  nidaNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | '';
  email: string;
  region: string;
  district: string;
  address: string;
  occupation: string;
  sourceOfFunds: string;
  tin: string;
  pepDeclared: boolean | null;
  tcbAccount: string;
}

export interface Onboarding {
  reference: string;
  status: 'draft' | 'under_review' | 'info_requested' | 'approved' | 'rejected';
  nextStep: NextStep;
  bank: { status: 'existing' | 'requested' | 'opened' | null; account: string | null };
  cds: { status: 'none' | 'requested' | 'active'; account: string | null };
  canBid: boolean;
  profile: (Omit<IndividualProfile, 'middleName' | 'email' | 'tin' | 'tcbAccount' | 'pepDeclared'> & {
    middleName: string | null;
    email: string | null;
    tin: string | null;
    tcbAccount: string | null;
    pepDeclared: boolean;
  }) | null;
}

const post = <T>(service: 'identity' | 'investor', path: string, body?: unknown, auth = true) =>
  request<T>(service, path, { method: 'POST', body, auth });

export const accountApi = {
  startRegistration: (phoneNumber: string) =>
    post<CodeSent>('identity', '/v1/auth/register/start', { phoneNumber }, false),
  verifyRegistration: (phoneNumber: string, code: string) =>
    post<Tokens>('identity', '/v1/auth/register/verify', { phoneNumber, code }, false),
  setPin: (pin: string) => post<void>('identity', '/v1/auth/pin', { pin }),
  signIn: (phoneNumber: string, pin: string) =>
    post<Tokens>('identity', '/v1/auth/login', { phoneNumber, pin }, false),
  startPinReset: (phoneNumber: string) =>
    post<CodeSent>('identity', '/v1/auth/pin/reset/start', { phoneNumber }, false),
  completePinReset: (phoneNumber: string, code: string, newPin: string) =>
    post<Tokens>('identity', '/v1/auth/pin/reset/complete', { phoneNumber, code, newPin }, false),
  refresh: (refreshToken: string) =>
    post<Tokens>('identity', '/v1/auth/token/refresh', { refreshToken }, false),
  signOut: () => post<void>('identity', '/v1/auth/logout'),
  me: () => request<Me>('identity', '/v1/auth/me'),

  onboarding: () => request<Onboarding>('investor', '/v1/investors/me'),
  saveProfile: (profile: IndividualProfile) =>
    request<Onboarding>('investor', '/v1/investors/me/profile', {
      method: 'PUT',
      body: {
        ...profile,
        // Optional fields go absent rather than blank.
        middleName: profile.middleName || undefined,
        email: profile.email || undefined,
        tin: profile.tin || undefined,
        tcbAccount: profile.tcbAccount || undefined,
      },
    }),
  submit: (consents: { acceptTerms: boolean; acceptDataProcessing: boolean; acceptCdsMandate: boolean }) =>
    post<Onboarding>('investor', '/v1/investors/me/submit', consents),
};
