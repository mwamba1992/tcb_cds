/**
 * Message templates, English and Kiswahili (TAD §6: bilingual by default).
 *
 * In code for now so wording changes are reviewed like any other change. When TCB's
 * marketing and compliance teams need to edit copy without a release, these move to a
 * table behind the settings screen; the keys stay the same.
 *
 * SMS bodies stay within two segments (≈ 300 characters): Tanzanian networks bill per
 * segment, and a code split across three messages arrives out of order often enough to
 * matter.
 */

export type Locale = 'en' | 'sw';

export const TEMPLATES = {
  'otp.registration': {
    en: 'TCB Government Securities: your verification code is {code}. It expires in {minutes} minutes. Never share this code.',
    sw: 'TCB Dhamana za Serikali: namba yako ya uthibitisho ni {code}. Itaisha baada ya dakika {minutes}. Usimpe mtu yeyote namba hii.',
  },
  'otp.login': {
    en: 'TCB Government Securities: your sign-in code is {code}. It expires in {minutes} minutes. If this was not you, call TCB on 0800 780 100.',
    sw: 'TCB Dhamana za Serikali: namba yako ya kuingia ni {code}. Itaisha baada ya dakika {minutes}. Kama si wewe, piga TCB 0800 780 100.',
  },
  'pin.set': {
    en: 'TCB Government Securities: your transaction PIN has been set. If you did not do this, call TCB on 0800 780 100 now.',
    sw: 'TCB Dhamana za Serikali: PIN yako ya miamala imewekwa. Kama si wewe, piga TCB 0800 780 100 sasa.',
  },
  'onboarding.submitted': {
    en: 'Thank you, {name}. We are verifying your details for TCB Government Securities and will message you when your account is ready.',
    sw: 'Asante, {name}. Tunathibitisha taarifa zako kwa TCB Dhamana za Serikali na tutakutumia ujumbe akaunti yako ikiwa tayari.',
  },
  'kyc.under_review': {
    en: '{name}, your TCB Government Securities application needs a quick review by our team. We will be in touch within one working day.',
    sw: '{name}, maombi yako ya TCB Dhamana za Serikali yanahitaji ukaguzi mfupi wa timu yetu. Tutawasiliana nawe ndani ya siku moja ya kazi.',
  },
  'kyc.approved': {
    en: '{name}, your details are verified. We have requested your CDS account from the Bank of Tanzania and will message you when you can bid.',
    sw: '{name}, taarifa zako zimethibitishwa. Tumeomba akaunti yako ya CDS kutoka Benki Kuu na tutakujulisha utakapoweza kununua.',
  },
  'kyc.rejected': {
    en: '{name}, we could not verify your TCB Government Securities application. Please visit any TCB branch with your NIDA ID.',
    sw: '{name}, hatukuweza kuthibitisha maombi yako ya TCB Dhamana za Serikali. Tafadhali tembelea tawi lolote la TCB na kitambulisho chako cha NIDA.',
  },
  'cds.opened': {
    en: '{name}, your CDS account {cds} is open. You can now bid in Treasury Bill and Bond auctions with TCB.',
    sw: '{name}, akaunti yako ya CDS {cds} imefunguliwa. Sasa unaweza kununua Hati Fungani na Dhamana za Serikali kupitia TCB.',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type TemplateKey = keyof typeof TEMPLATES;

export function isTemplateKey(key: string): key is TemplateKey {
  return key in TEMPLATES;
}

/** Fills {placeholders}. A missing variable is left visible rather than silently blank. */
export function render(
  key: TemplateKey,
  locale: Locale,
  variables: Record<string, string>,
): string {
  return TEMPLATES[key][locale].replace(
    /\{(\w+)\}/g,
    (match, name: string) => variables[name] ?? match,
  );
}
