import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';
import { LANGUAGES } from '../i18n/context';

// Share of the credits left, below which the bar turns warning colours
const LOW = 0.1;
const GETTING_LOW = 0.3;

export default function BalanceSection() {
  const { t, lang } = useI18n();
  const locale = LANGUAGES.find((l) => l.code === lang)?.htmlLang;
  const [balance, setBalance] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (fresh) => {
    setLoading(true);
    setError('');
    try {
      setBalance(await api.getBalance(fresh));
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const money = (value) =>
    value == null
      ? '-'
      : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);

  // The account's credits when OpenRouter gives them, else this key's own limit
  const remaining = balance?.remaining ?? balance?.key_limit_remaining ?? null;
  const total = balance?.remaining != null ? balance.total_credits : balance?.key_limit;
  const share = remaining != null && total ? Math.max(0, Math.min(1, remaining / total)) : null;
  const level = share == null ? '' : share < LOW ? 'low' : share < GETTING_LOW ? 'warn' : 'ok';

  const stats = balance && [
    ['balance.total', balance.total_credits],
    ['balance.used', balance.total_usage],
    ['balance.today', balance.usage_daily],
    ['balance.week', balance.usage_weekly],
    ['balance.month', balance.usage_monthly],
  ].filter(([, value]) => value != null);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.balance')}</h3>

      {error && (
        <div className="instructions-error">{t('balance.error', { message: error })}</div>
      )}

      {balance && (
        <>
          <div className="balance-main">
            <div className="balance-label">
              {t(balance.remaining != null ? 'balance.remaining' : 'balance.keyLeft')}
            </div>
            <div className={`balance-amount ${level}`}>{money(remaining)}</div>
            {share != null && (
              <div className="balance-bar" aria-hidden="true">
                <span className={`balance-bar-fill ${level}`} style={{ width: `${share * 100}%` }} />
              </div>
            )}
          </div>

          <dl className="balance-stats">
            {stats.map(([key, value]) => (
              <div key={key} className="balance-stat">
                <dt>{t(key)}</dt>
                <dd>{money(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {!balance && loading && <p className="instructions-help">{t('balance.loading')}</p>}

      <div className="balance-footer">
        <button className="balance-refresh" onClick={() => load(true)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          {t('balance.refresh')}
        </button>
        {updatedAt && (
          <span className="balance-updated">
            {t('balance.updated', { time: updatedAt.toLocaleTimeString(locale) })}
          </span>
        )}
      </div>

      <p className="instructions-help">{t('balance.note')}</p>
    </div>
  );
}
