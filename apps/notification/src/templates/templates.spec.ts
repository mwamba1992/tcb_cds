import { TEMPLATES, render, type Locale, type TemplateKey } from './templates';
import { maskPhone } from '../dispatch/dispatch.service';

describe('templates', () => {
  it('has every message in both English and Kiswahili', () => {
    for (const [key, text] of Object.entries(TEMPLATES)) {
      expect({ key, en: text.en.length > 0, sw: text.sw.length > 0 }).toEqual({
        key,
        en: true,
        sw: true,
      });
    }
  });

  it('keeps every message within two SMS segments with realistic values', () => {
    const values = {
      code: '482913',
      minutes: '5',
      name: 'Amina Said Mfinanga',
      cds: 'CDS-TCB-0048213',
    };
    for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
      for (const locale of ['en', 'sw'] as Locale[]) {
        expect({ key, locale, length: render(key, locale, values).length <= 306 }).toEqual({
          key,
          locale,
          length: true,
        });
      }
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, text] of Object.entries(TEMPLATES)) {
      expect({ key, sw: placeholders(text.sw) }).toEqual({ key, sw: placeholders(text.en) });
    }
  });

  it('fills placeholders, and leaves a missing one visible rather than blank', () => {
    expect(render('otp.registration', 'en', { code: '482913', minutes: '5' })).toContain('482913');
    expect(render('otp.registration', 'en', { code: '482913' })).toContain('{minutes}');
  });

  it('masks phone numbers for the delivery log', () => {
    expect(maskPhone('+255712345678')).toBe('+255 712 •••678');
    expect(maskPhone('12')).toBe('•••');
  });
});
