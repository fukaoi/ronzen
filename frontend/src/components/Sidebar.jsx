import { useState, useEffect } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  streamingId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
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
        <h1>LLM COUNCIL2</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
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
                    className="conversation-edit-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(conv);
                    }}
                  >
                    Edit
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
