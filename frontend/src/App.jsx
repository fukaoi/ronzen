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

  // Attachments waiting for a conversation that has just been created, so a
  // carried-over summary is in the box the moment the new conversation opens
  const [pendingAttachments, setPendingAttachments] = useState({});

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

      if (conv.running) {
        attachToRun(id);
      }
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
   * Re-read how much history this conversation now carries.
   *
   * Only those two fields are taken: replacing the conversation would drop
   * the stage 2 metadata, which the server does not store.
   */
  const refreshContextSize = async (conversationId) => {
    try {
      const conv = await api.getConversation(conversationId);
      setConversationsById((prev) => {
        const current = prev[conversationId];
        if (!current) return prev;
        return {
          ...prev,
          [conversationId]: {
            ...current,
            context_chars: conv.context_chars,
            context_heavy: conv.context_heavy,
          },
        };
      });
    } catch (error) {
      console.error('Failed to refresh the context size:', error);
    }
  };

  /**
   * Start a fresh conversation carrying this one's conclusion.
   */
  const handleHandOff = async () => {
    if (!currentConversationId || streamingIdRef.current) return;

    try {
      const { conversation, attachment } = await api.handOff(
        currentConversationId
      );

      setConversations((prev) => [
        {
          id: conversation.id,
          created_at: conversation.created_at,
          title: conversation.title,
          message_count: 0,
        },
        ...prev,
      ]);
      setConversationsById((prev) => ({
        ...prev,
        [conversation.id]: conversation,
      }));
      setPendingAttachments((prev) => ({
        ...prev,
        [conversation.id]: [attachment],
      }));
      setCurrentConversationId(conversation.id);
    } catch (error) {
      console.error('Failed to carry the conversation over:', error);
    }
  };

  /**
   * Take back the last question and its answer.
   *
   * The truncation is mirrored locally rather than taken from the response,
   * because the stored conversation has no stage 2 metadata: the server never
   * saves it, so replacing what is on screen would lose the de-anonymised
   * rankings of every earlier turn.
   *
   * @param {boolean} keepAttachments - Leave the uploads for the composer
   * @returns {Promise<boolean>} Whether the turn was removed
   */
  const removeLastTurn = async (keepAttachments) => {
    const conversationId = currentConversationId;
    if (!conversationId || streamingIdRef.current) return false;

    try {
      await api.deleteLastTurn(conversationId, keepAttachments);
    } catch (error) {
      console.error('Failed to remove the last turn:', error);
      return false;
    }

    setConversationsById((prev) => {
      const conversation = prev[conversationId];
      if (!conversation) return prev;

      const messages = conversation.messages;
      let lastUser = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUser = i;
          break;
        }
      }
      if (lastUser === -1) return prev;

      return {
        ...prev,
        [conversationId]: {
          ...conversation,
          messages: messages.slice(0, lastUser),
        },
      };
    });

    loadConversations();
    return true;
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

  /**
   * The assistant message the stages land in while a run is going.
   */
  const pendingAssistantMessage = () => ({
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
  });

  /**
   * Handle the stage events of one run, wherever the stream came from:
   * the request that started it, or a reattach after a reload.
   */
  const makeRunEventHandler = (conversationId) => (eventType, event) => {
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
        refreshContextSize(conversationId);
        break;

      case 'error':
        console.error('Stream error:', event.message);
        break;

      default:
        console.log('Unknown event type:', eventType);
    }
  };

  /**
   * Pick a council run back up after a reload.
   *
   * The run belongs to the server, so the question that was asked before the
   * page went away still has an answer coming; this follows it from the
   * first stage rather than leaving the question sitting there alone.
   */
  const attachToRun = async (conversationId) => {
    if (streamingIdRef.current) return;

    streamingIdRef.current = conversationId;
    setStreamingId(conversationId);

    // The saved conversation ends with the unanswered question, so the
    // stages need somewhere to land
    appendMessages(conversationId, pendingAssistantMessage());

    try {
      const followed = await api.followRun(
        conversationId,
        makeRunEventHandler(conversationId)
      );
      if (!followed) {
        // It finished between the page load and this call: the answer is
        // saved, so drop the placeholder and take the stored version
        setConversationsById((prev) => {
          const conversation = prev[conversationId];
          if (!conversation) return prev;
          return {
            ...prev,
            [conversationId]: {
              ...conversation,
              messages: conversation.messages.slice(0, -1),
            },
          };
        });
        streamingIdRef.current = null;
        await loadConversation(conversationId);
      }
    } catch (error) {
      console.error('Failed to follow the council run:', error);
    } finally {
      streamingIdRef.current = null;
      setStreamingId(null);
    }
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

    setPendingAttachments((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });

    try {
      // Optimistically add the user message, then a partial assistant message
      // that the stages fill in as they arrive
      appendMessages(
        conversationId,
        { role: 'user', content, images, files },
        pendingAssistantMessage()
      );

      const fileNames = files.map((file) => file.filename);

      await api.sendMessageStream(
        conversationId,
        content,
        images,
        fileNames,
        makeRunEventHandler(conversationId)
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
        onRenameConversation={async (id, title) => {
          try {
            await api.renameConversation(id, title);
            loadConversations();
          } catch (error) {
            console.error('Failed to rename conversation:', error);
          }
        }}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={streamingId !== null && streamingId === currentConversationId}
        busyElsewhere={streamingId !== null && streamingId !== currentConversationId}
        onEditLastTurn={() => removeLastTurn(true)}
        onDeleteLastTurn={() => removeLastTurn(false)}
        onHandOff={handleHandOff}
        initialAttachments={pendingAttachments[currentConversationId]}
      />
    </div>
  );
}

export default App;
