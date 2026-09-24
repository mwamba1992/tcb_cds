/** Tanzania's 31 administrative regions, for the address on the onboarding form. */
export const TZ_REGIONS = [
  'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Kaskazini Pemba',
  'Kaskazini Unguja', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Kusini Pemba', 'Kusini Unguja',
  'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Mjini Magharibi', 'Morogoro', 'Mtwara', 'Mwanza',
  'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe', 'Tabora',
  'Tanga',
] as const;

export const SOURCES_OF_FUNDS = [
  { value: 'salary', label: 'Salary' },
  { value: 'business', label: 'Business income' },
  { value: 'savings', label: 'Savings' },
  { value: 'pension', label: 'Pension' },
  { value: 'inheritance', label: 'Inheritance or gift' },
  { value: 'other', label: 'Other' },
] as const;
