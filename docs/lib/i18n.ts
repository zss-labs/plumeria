import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'ja'],
  parser: 'dir',
  hideLocale: 'default-locale',
});

export type Language = (typeof i18n.languages)[number];
