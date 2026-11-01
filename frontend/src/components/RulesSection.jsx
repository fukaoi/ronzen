import { useState, useEffect } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';

const MAX_CHARS = 4000;

const EXAMPLE_KEYS = ['rules.example1', 'rules.example2'];

export default function RulesSection({ onClose }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getInstructions()
      .then((current) => {
        setText(current);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveInstructions(text);
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.rules')}</h3>
      <p className="instructions-help">
        {t('rules.help')}
      </p>

      <textarea
        value={text}
        rows={8}
        maxLength={MAX_CHARS}
        disabled={!loaded}
        placeholder={EXAMPLE_KEYS.map((k) => `・${t(k)}`).join('\n')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="instructions-count">
        {text.length} / {MAX_CHARS}
      </div>

      {error && <div className="instructions-error">{error}</div>}

      <div className="instructions-actions">
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button
          className="instructions-primary"
          disabled={!loaded || saving}
          onClick={save}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
