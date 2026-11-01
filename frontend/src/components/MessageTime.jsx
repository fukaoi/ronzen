import { useI18n } from '../i18n/useI18n';
import { LANGUAGES } from '../i18n/context';

/** When something was sent or finished, in the viewer's own time zone. */
export default function MessageTime({ value, className = '' }) {
  const { lang } = useI18n();
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const locale = LANGUAGES.find((l) => l.code === lang)?.htmlLang;
  const text = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return (
    <time className={`message-time ${className}`.trim()} dateTime={value}>
      {text}
    </time>
  );
}
