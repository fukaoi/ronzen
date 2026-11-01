import { useState } from 'react';
import { ScrollText, Languages, X } from 'lucide-react';
import RulesSection from './RulesSection';
import LanguageSection from './LanguageSection';
import { useI18n } from '../i18n/useI18n';
import './SettingsDialog.css';

// Add a new settings page by appending an entry here
const SECTIONS = [
  { id: 'rules', labelKey: 'settings.rules', icon: <ScrollText size={16} />, Component: RulesSection },
  { id: 'language', labelKey: 'settings.language', icon: <Languages size={16} />, Component: LanguageSection },
];

export default function SettingsDialog({ onClose }) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const Active = SECTIONS.find((s) => s.id === activeId).Component;

  return (
    <div className="instructions-overlay" onClick={onClose}>
      <div
        className="instructions-dialog settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{t('common.settings')}</h2>
          <button
            className="settings-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map(({ id, labelKey, icon }) => (
              <button
                key={id}
                className={`settings-nav-item ${id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(id)}
              >
                {icon}
                {t(labelKey)}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <Active onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
