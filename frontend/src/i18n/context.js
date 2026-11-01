import { createContext } from 'react';
import { en, ja, zh, es } from './messages';

export const STORAGE_KEY = 'ronzen.language';
export const DEFAULT_LANGUAGE = 'en';

// `label` is written in the language itself, so it can be found from any other.
// `htmlLang` goes on <html lang>, which also picks the right glyphs for Han
// characters and the right fonts.
export const LANGUAGES = [
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'ja', label: '日本語', htmlLang: 'ja' },
  { code: 'zh', label: '中文（简体）', htmlLang: 'zh-CN' },
  { code: 'es', label: 'Español', htmlLang: 'es' },
];

const DICTIONARIES = { en, ja, zh, es };

/** Look a key up in a language, falling back to English, then to the key. */
export function translate(lang, key, params) {
  const template = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  );
}

export const I18nContext = createContext({
  lang: DEFAULT_LANGUAGE,
  setLang: () => {},
  t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
});
