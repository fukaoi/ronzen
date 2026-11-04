import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

/**
 * Opens and closes the sidebar. The icon shows what a click will do, and a
 * closed sidebar leaves the button in the accent colour, so which state the
 * page is in reads at a glance even though the button itself stays small.
 */
export default function SidebarToggle({ open, onToggle }) {
  const { t } = useI18n();
  const label = open ? t('sidebar.close') : t('sidebar.open');
  const Icon = open ? PanelLeftClose : PanelLeftOpen;

  return (
    <button
      type="button"
      className={`sidebar-toggle ${open ? '' : 'closed'}`}
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
      title={label}
    >
      <Icon size={18} strokeWidth={2} />
    </button>
  );
}
