import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

/**
 * Vietnamese is the source language: the Vietnamese sentence is the translation key.
 * A string missing from a dictionary falls back to the Vietnamese text, so the UI never
 * shows raw keys and translations can be added incrementally.
 */
export const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
] as const;

function initialLanguage() {
  try {
    const saved = localStorage.getItem('startup.lang');
    if (saved === 'vi' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'vi';
}

void i18n.use(initReactI18next).init({
  resources: { vi: { translation: {} }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem('startup.lang', lng);
  } catch {
    /* storage unavailable */
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
