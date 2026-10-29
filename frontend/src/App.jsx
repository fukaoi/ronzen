import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);

  // Conversations are kept by id rather than as a single "current" object.
  // A council run streams its stages into the conversation it belongs to, and
  // the backend only saves the assistant message once all three stages are
  // done - so switching away mid-run would otherwise throw the progress away
  // and show the question on its own when you came back.
  const [conversationsById, setConversationsById] = useState({});

  const [streamingId, setStreamingId] = useState(null);
  const streamingIdRef = useRef(null);

  const currentConversation = currentConversationId
    ? conversationsById[currentConversationId] ?? null
    : null;

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setConversationsById((prev) => {
        // A run in flight holds stages the server does not have yet, and
        // metadata it never stores at all. Keep what is on screen.
        if (prev[id] && streamingIdRef.current === id) {
          return prev;
        }
        return { ...prev, [id]: conv };
      });
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        {
          id: newConv.id,
          created_at: newConv.created_at,
          title: newConv.title,
          message_count: 0,
        },
        ...conversations,
      ]);
      setConversationsById((prev) => ({ ...prev, [newConv.id]: newConv }));
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  /**
   * Append messages to one conversation, whether or not it is on screen.
   */
  const appendMessages = (conversationId, ...newMessages) => {
    setConversationsById((prev) => {
      const conversation = prev[conversationId];
      if (!conversation) return prev;
      return {
        ...prev,
        [conversationId]: {
          ...conversation,
          messages: [...conversation.messages, ...newMessages],
        },
      };
    });
  };

  /**
   * Patch the last message of one conversation. `patch` receives that message
   * and returns the fields to change.
   */
  const patchLastMessage = (conversationId, patch) => {
    setConversationsById((prev) => {
      const conversation = prev[conversationId];
      if (!conversation || conversation.messages.length === 0) return prev;

      const messages = [...conversation.messages];
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, ...patch(last) };

      return {
        ...prev,
        [conversationId]: { ...conversation, messages },
      };
    });
  };

  const setStageLoading = (conversationId, stage, value) => {
    patchLastMessage(conversationId, (msg) => ({
      loading: { ...msg.loading, [stage]: value },
    }));
  };

  // `files` carries both halves of a text attachment: the stored filename the
  // API needs, and the display name the message bubble shows right away.
  const handleSendMessage = async (content, images = [], files = []) => {
    if (!currentConversationId || streamingIdRef.current) return;

    // Pin the run to this conversation: every update below targets this id,
    // so looking at another conversation meanwhile changes nothing there.
    const conversationId = currentConversationId;
    streamingIdRef.current = conversationId;
    setStreamingId(conversationId);

    try {
      // Optimistically add the user message, then a partial assistant message
      // that the stages fill in as they arrive
      appendMessages(
        conversationId,
        { role: 'user', content, images, files },
        {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: null,
          loading: {
            stage1: false,
            stage2: false,
            stage3: false,
          },
        }
      );

      const fileNames = files.map((file) => file.filename);

      await api.sendMessageStream(
        conversationId,
        content,
        images,
        fileNames,
        (eventType, event) => {
          switch (eventType) {
            case 'stage1_start':
              setStageLoading(conversationId, 'stage1', true);
              break;

            case 'stage1_complete':
              patchLastMessage(conversationId, (msg) => ({
                stage1: event.data,
                loading: { ...msg.loading, stage1: false },
              }));
              break;

            case 'stage2_start':
              setStageLoading(conversationId, 'stage2', true);
              break;

            case 'stage2_complete':
              patchLastMessage(conversationId, (msg) => ({
                stage2: event.data,
                metadata: event.metadata,
                loading: { ...msg.loading, stage2: false },
              }));
              break;

            case 'stage3_start':
              setStageLoading(conversationId, 'stage3', true);
              break;

            case 'stage3_complete':
              patchLastMessage(conversationId, (msg) => ({
                stage3: event.data,
                loading: { ...msg.loading, stage3: false },
              }));
              break;

            case 'title_complete':
              // Reload conversations to get updated title
              loadConversations();
              break;

            case 'complete':
              // Stream complete, reload conversations list
              loadConversations();
              break;

            case 'error':
              console.error('Stream error:', event.message);
              break;

            default:
              console.log('Unknown event type:', eventType);
          }
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      // Drop the optimistic messages from the conversation they were added to
      setConversationsById((prev) => {
        const conversation = prev[conversationId];
        if (!conversation) return prev;
        return {
          ...prev,
          [conversationId]: {
            ...conversation,
            messages: conversation.messages.slice(0, -2),
          },
        };
      });
    } finally {
      streamingIdRef.current = null;
      setStreamingId(null);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        streamingId={streamingId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={streamingId !== null && streamingId === currentConversationId}
        busyElsewhere={streamingId !== null && streamingId !== currentConversationId}
      />
    </div>
  );
}

export default App;
