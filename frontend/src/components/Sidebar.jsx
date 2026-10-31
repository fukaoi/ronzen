import { useState } from 'react';
import { Plus, Landmark, ScrollText, Trash2 } from 'lucide-react';
import Logo from './Logo';
import './Sidebar.css';

// The backend titles a mission's conversation with this prefix
const MISSION_TITLE_PREFIX = 'Mission: ';

export default function Sidebar({
  conversations,
  currentConversationId,
  streamingId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  view,
  onShowMissions,
  onShowRules,
}) {
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
    const title = conv.title || 'New Conversation';
    if (
      window.confirm(
        `Delete "${title}" and its ${conv.message_count} messages? This cannot be undone.`
      )
    ) {
      onDeleteConversation(conv.id);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <Logo size={44} />
          <h1>LLM COUNCIL2</h1>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          <Plus size={16} strokeWidth={2.4} />
          New Conversation
        </button>
        <button
          className={`missions-btn ${view === 'missions' ? 'active' : ''}`}
          onClick={onShowMissions}
        >
          <Landmark size={15} />
          Missions β
        </button>
        <button className="missions-btn" onClick={onShowRules}>
          <ScrollText size={15} />
          Council Rules
        </button>
      </div>

      <div
        className={`conversation-list ${view === 'missions' ? 'inactive' : ''}`}
      >
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
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
                  {conv.title || 'New Conversation'}
                </div>
              )}
              <div className="conversation-meta">
                {conv.id === streamingId || conv.running ? (
                  <span className="conversation-running">
                    <span className="running-dot"></span>
                    Consulting the council...
                  </span>
                ) : (
                  `${conv.message_count} messages`
                )}
                {editingId !== conv.id && (
                  <span className="conversation-actions">
                    <button
                      type="button"
                      className="conversation-edit-btn"
                      title="Rename"
                      aria-label="Rename conversation"
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
                      title="Delete"
                      aria-label="Delete conversation"
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
