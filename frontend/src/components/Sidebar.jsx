import { useState, useEffect } from 'react';
import { Plus, Landmark } from 'lucide-react';
import Logo from './Logo';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  streamingId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  view,
  onShowMissions,
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
          Missions
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
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
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
