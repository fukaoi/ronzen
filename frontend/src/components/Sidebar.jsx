import { useState } from 'react';
import { Plus, Settings, Trash2 } from 'lucide-react';
import ToriiIcon from './ToriiIcon';
import { useI18n } from '../i18n/useI18n';
import Logo from './Logo';
import './Sidebar.css';

// The backend titles a mission's conversation with this prefix
const MISSION_TITLE_PREFIX = 'Mission: ';

export default function Sidebar({
  open = true,
  conversations,
  currentConversationId,
  streamingId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  view,
  onShowMissions,
  onShowSettings,
}) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const startEditing = (conv) => {
    setEditingId(conv.id);
    setDraft(conv.title || '');
  };

  const commit = (conv) => {
    const title = draft.trim();
    setEditingId(null);
    if (title && title !== conv.title) {
      onRenameConversation(conv.id, title);
    }
  };

  const confirmDelete = (conv) => {
    const title = conv.title || t('sidebar.untitled');
    if (
      window.confirm(
        t('sidebar.confirmDelete', { title, n: conv.message_count })
      )
    ) {
      onDeleteConversation(conv.id);
    }
  };

  return (
    <div className={`sidebar ${open ? '' : 'collapsed'}`} inert={!open}>
      <div className="sidebar-header">
        <div className="brand">
          <Logo size={44} />
          <div className="brand-text">
            <h1>Ronzen</h1>
            <span className="brand-sub">LLM Council</span>
          </div>
          <button
            className="settings-btn"
            onClick={onShowSettings}
            title={t('common.settings')}
            aria-label={t('common.settings')}
          >
            <Settings size={18} />
          </button>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          <Plus size={16} strokeWidth={2.4} />
          {t('sidebar.newConversation')}
        </button>
        <button
          className={`missions-btn ${view === 'missions' ? 'active' : ''}`}
          onClick={onShowMissions}
        >
          <ToriiIcon size={16} />
          {t('sidebar.missions')}
        </button>
      </div>

      <div
        className={`conversation-list ${view === 'missions' ? 'inactive' : ''}`}
      >
        {conversations.length === 0 ? (
          <div className="no-conversations">{t('sidebar.none')}</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                view === 'chat' && conv.id === currentConversationId ? 'active' : ''
              } ${conv.title?.startsWith(MISSION_TITLE_PREFIX) ? 'mission' : ''}`}
              onClick={() => onSelectConversation(conv.id)}
            >
              {editingId === conv.id ? (
                <input
                  className="conversation-title-input"
                  value={draft}
                  autoFocus
                  maxLength={100}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(conv)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      commit(conv);
                    } else if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <div className="conversation-title">
                  {conv.title || t('sidebar.untitled')}
                </div>
              )}
              <div className="conversation-meta">
                {conv.id === streamingId || conv.running ? (
                  <span className="conversation-running">
                    <span className="running-dot"></span>
                    {t('sidebar.consulting')}
                  </span>
                ) : (
                  t('sidebar.messages', { n: conv.message_count })
                )}
                {editingId !== conv.id && (
                  <span className="conversation-actions">
                    <button
                      type="button"
                      className="conversation-edit-btn"
                      title={t('sidebar.rename')}
                      aria-label={t('sidebar.renameAria')}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(conv);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="conversation-edit-btn conversation-delete-btn"
                      title={t('common.delete')}
                      aria-label={t('sidebar.deleteAria')}
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(conv);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
