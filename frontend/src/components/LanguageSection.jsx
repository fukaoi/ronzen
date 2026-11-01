import { LANGUAGES } from '../i18n/context';
import { useI18n } from '../i18n/useI18n';

export default function LanguageSection() {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.language')}</h3>
      <p className="instructions-help">{t('settings.languageHelp')}</p>

      <div className="language-options" role="radiogroup" aria-label={t('settings.language')}>
        {LANGUAGES.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={lang === code}
            className={`language-option ${lang === code ? 'active' : ''}`}
            onClick={() => setLang(code)}
          >
            <span className="language-option-mark" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <p className="instructions-help language-note">{t('settings.languageNote')}</p>
    </div>
  );
}
