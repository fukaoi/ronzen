import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  I18nContext,
  LANGUAGES,
  DEFAULT_LANGUAGE,
  STORAGE_KEY,
  translate,
} from './context';

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.some((l) => l.code === stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Storage can be blocked (private windows, site settings)
    return DEFAULT_LANGUAGE;
  }
}

export default function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLanguage);

  useEffect(() => {
    const { htmlLang } = LANGUAGES.find((l) => l.code === lang);
    document.documentElement.lang = htmlLang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // The choice still applies for this visit
    }
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
