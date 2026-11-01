import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Stamp, ArrowUp, ArrowDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import CouncilRoster from './CouncilRoster';
import Logo from './Logo';
import StageLoader from './StageLoader';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';
import MessageTime from './MessageTime';
import './ChatInterface.css';

// Ctrl+Enter sends everywhere; on a Mac the same shortcut is Cmd+Enter
const SEND_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘+Enter'
    : 'Ctrl+Enter';

// Scrolling this far in one direction brings out the matching jump button (up
// shows "top", down shows "bottom"); within SCROLL_END_PX of an end it goes away.
// A move back of less than SCROLL_REVERSAL_PX is jitter, not a change of
// direction: touch screens report small nudges against the swipe all the time.
const SCROLL_DIRECTION_PX = 120;
const SCROLL_END_PX = 100;
const SCROLL_REVERSAL_PX = 12;

const ASK_MODES = [
  {
    id: 'council',
    labelKey: 'chat.modeCouncil',
    Icon: Users,
    hintKey: 'chat.modeCouncilHint',
  },
  {
    id: 'chairman',
    labelKey: 'chat.modeChairman',
    Icon: Stamp,
    hintKey: 'chat.modeChairmanHint',
  },
];

/**
 * Read a File as a base64 data URL.
 */
function readFileAsDataUrl(file, t) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('chat.readFailed', { name: file.name })));
    reader.readAsDataURL(file);
  });
}

/**
 * Human-readable size for an attachment chip.
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3v5h5" />
      <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
    </svg>
  );
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  busyElsewhere = false,
  onEditLastTurn,
  onDeleteLastTurn,
  onHandOff,
  initialAttachments,
}) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [askMode, setAskMode] = useState('council');
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesRef = useRef(null);
  const fileInputRef = useRef(null);
  const [scrollButtons, setScrollButtons] = useState({ top: false, bottom: false });
  // The current run of scrolling: its direction, where it began, and how far it has got
  const scrollRun = useRef({ direction: 'down', start: 0, furthest: 0 });
  const ignoreScrollUntil = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToTop = () => {
    messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // The direction the reader is scrolling decides which button shows. Moves
  // made by the page itself (following a new answer) are not the reader's.
  const updateScrollButtons = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;

    const top = el.scrollTop;
    const fromBottom = el.scrollHeight - top - el.clientHeight;
    const run = scrollRun.current;

    if (Date.now() < ignoreScrollUntil.current) {
      // Not the reader's scrolling: begin again from wherever the page is
      scrollRun.current = { direction: 'down', start: top, furthest: top };
    } else if (run.direction === 'down') {
      if (top > run.furthest) run.furthest = top;
      else if (run.furthest - top >= SCROLL_REVERSAL_PX) {
        scrollRun.current = { direction: 'up', start: run.furthest, furthest: top };
      }
    } else if (top < run.furthest) {
      run.furthest = top;
    } else if (top - run.furthest >= SCROLL_REVERSAL_PX) {
      scrollRun.current = { direction: 'down', start: run.furthest, furthest: top };
    }

    const { direction, start, furthest } = scrollRun.current;
    const travelled = Math.abs(furthest - start);

    setScrollButtons((prev) => {
      let showTop = prev.top;
      let showBottom = prev.bottom;
      if (direction === 'up' && travelled >= SCROLL_DIRECTION_PX) {
        showTop = true;
        showBottom = false;
      } else if (direction === 'down' && travelled >= SCROLL_DIRECTION_PX) {
        showTop = false;
        showBottom = true;
      }
      if (top <= SCROLL_END_PX) showTop = false;
      if (fromBottom <= SCROLL_END_PX) showBottom = false;
      return prev.top === showTop && prev.bottom === showBottom
        ? prev
        : { top: showTop, bottom: showBottom };
    });
  }, []);

  useEffect(() => {
    // Following the conversation down is not the reader scrolling
    ignoreScrollUntil.current = Date.now() + 1500;
    scrollToBottom();
  }, [conversation]);

  useEffect(() => {
    updateScrollButtons();
    window.addEventListener('resize', updateScrollButtons);
    return () => window.removeEventListener('resize', updateScrollButtons);
  }, [conversation, updateScrollButtons]);

  // Clear the composer when switching conversations. A conversation just
  // created by a hand-off arrives with its carried-over summary ready to send.
  useEffect(() => {
    setInput('');
    setAttachments(initialAttachments ?? []);
    setUploadError(null);
  }, [conversation?.id]);

  const addFiles = async (fileList) => {
    const picked = Array.from(fileList);
    if (picked.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const items = await Promise.all(
        picked.map(async (file) => ({
          data_url: await readFileAsDataUrl(file, t),
          name: file.name,
        }))
      );
      const uploaded = await api.uploadFiles(items);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      console.error('Failed to upload attachments:', error);
      setUploadError(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    addFiles(e.target.files);
    // Reset so selecting the same file again still fires onChange
    e.target.value = '';
  };

  const handlePaste = (e) => {
    if (e.clipboardData?.files?.length) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeAttachment = (filename) => {
    setAttachments((prev) =>
      prev.filter((attachment) => attachment.filename !== filename)
    );
  };

  const attachedImages = attachments.filter((a) => a.kind === 'image');
  const attachedFiles = attachments.filter((a) => a.kind !== 'image');

  // Only the latest question can be taken back: anything earlier was the
  // context the later answers were written against.
  const messages = conversation?.messages ?? [];
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  const canAmendLastTurn =
    lastUserIndex !== -1 && !isLoading && !busyElsewhere && !isUploading;

  /**
   * Take the last question back into the composer, attachments and all.
   */
  const handleEditLastTurn = async (message) => {
    const removed = await onEditLastTurn?.();
    if (!removed) return;

    setInput(message.content || '');
    setAttachments([
      ...(message.images || []).map((filename) => ({
        filename,
        name: filename,
        kind: 'image',
      })),
      ...(message.files || []).map((file) => ({
        filename: file.filename,
        name: file.name,
        kind: 'text',
      })),
    ]);
    setUploadError(null);
  };

  const handleDeleteLastTurn = async () => {
    const confirmed = window.confirm(
      t('chat.confirmDeleteLast')
    );
    if (confirmed) {
      await onDeleteLastTurn?.();
    }
  };

  // One council run at a time: a second one would race the first for the
  // same rate limit and fan out another seven model calls.
  const canSend =
    (input.trim() || attachments.length > 0) &&
    !isLoading &&
    !busyElsewhere &&
    !isUploading;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSend) return;

    onSendMessage(
      input,
      attachedImages.map((image) => image.filename),
      attachedFiles.map(({ filename, name }) => ({ filename, name })),
      askMode
    );
    setInput('');
    setAttachments([]);
    setUploadError(null);
  };

  const handleKeyDown = (e) => {
    // Plain Enter inserts a newline (avoids accidental sends, incl. IME confirm);
    // submit only via Ctrl/Cmd+Enter or the send button
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>{t('chat.welcomeTitle')}</h2>
          <p>{t('chat.welcomeText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-wrap">
      <div className="messages-container" ref={messagesRef} onScroll={updateScrollButtons}>
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>{t('chat.startTitle')}</h2>
            <p>{t('chat.startText')}</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-head">
                    <div className="message-label">{t('chat.you')}</div>
                    <MessageTime value={msg.created_at} />
                  </div>
                  <div className="message-content">
                    {msg.images?.length > 0 && (
                      <div className="message-images">
                        {msg.images.map((filename) => (
                          <a
                            key={filename}
                            href={api.fileUrl(filename)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={api.fileUrl(filename)}
                              alt="Attached image"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {msg.files?.length > 0 && (
                      <div className="message-files">
                        {msg.files.map((file) => (
                          <a
                            key={file.filename}
                            className="file-chip"
                            href={api.fileUrl(file.filename)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileIcon />
                            <span className="file-chip-name">{file.name}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {index === lastUserIndex && canAmendLastTurn && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="message-action"
                        onClick={() => handleEditLastTurn(msg)}
                        title={t('chat.editHint')}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="message-action danger"
                        onClick={handleDeleteLastTurn}
                        title={t('chat.deleteHint')}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-head">
                    <div className="message-label">Ronzen</div>
                  </div>

                  <CouncilRoster
                    members={msg.stage1?.map((resp) => resp.model)}
                    chairman={msg.stage3?.model}
                  />

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <StageLoader stage={1}>{t('chat.stage1Running')}</StageLoader>
                  )}
                  {msg.stage1 && (
                    <Stage1 responses={msg.stage1} time={msg.stage_times?.stage1} />
                  )}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <StageLoader stage={2}>{t('chat.stage2Running')}</StageLoader>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      time={msg.stage_times?.stage2}
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <StageLoader stage={3}>
                      {msg.mode === 'chairman'
                        ? t('chat.chairmanRunning')
                        : t('chat.stage3Running')}
                    </StageLoader>
                  )}
                  {msg.stage3 && (
                    <Stage3
                      finalResponse={msg.stage3}
                      time={msg.stage_times?.stage3 || msg.created_at}
                      solo={msg.mode === 'chairman'}
                    />
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <Logo size={34} typing />
            <span>{t('chat.consulting')}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <button
        type="button"
        className={`scroll-fab scroll-fab-top ${scrollButtons.top ? '' : 'hide'}`}
        onClick={scrollToTop}
        aria-label={t('chat.scrollTop')}
        title={t('chat.scrollTop')}
        tabIndex={scrollButtons.top ? 0 : -1}
      >
        <ArrowUp size={18} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        className={`scroll-fab scroll-fab-bottom ${scrollButtons.bottom ? '' : 'hide'}`}
        onClick={scrollToBottom}
        aria-label={t('chat.scrollBottom')}
        title={t('chat.scrollBottom')}
        tabIndex={scrollButtons.bottom ? 0 : -1}
      >
        <ArrowDown size={18} strokeWidth={2.2} />
      </button>
      </div>

      <form
        className={`input-form ${isDragging ? 'dragging' : ''}`}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {conversation.context_chars > 0 && (
          <div
            className={`context-meter ${
              conversation.context_heavy ? 'heavy' : ''
            }`}
          >
            <span className="context-size">
              {t('chat.historyCarried')}{' '}
              <strong>
                {t('chat.characters', { n: conversation.context_chars.toLocaleString() })}
              </strong>
            </span>
            {conversation.context_heavy && (
              <>
                <span className="context-note">
                  {t('chat.contextNote')}
                </span>
                <button
                  type="button"
                  className="handoff-button"
                  onClick={onHandOff}
                  disabled={isLoading || busyElsewhere}
                >
                  {t('chat.carryOn')}
                </button>
              </>
            )}
          </div>
        )}

        {attachedImages.length > 0 && (
          <div className="attachment-previews">
            {attachedImages.map((image) => (
              <div key={image.filename} className="attachment-preview">
                <img src={api.fileUrl(image.filename)} alt="Attachment" />
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => removeAttachment(image.filename)}
                  title={t('chat.removeAttachment')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="attachment-files">
            {attachedFiles.map((file) => (
              <div key={file.filename} className="file-chip">
                <FileIcon />
                <span className="file-chip-name">{file.name}</span>
                {file.size != null && (
                  <span className="file-chip-size">{formatSize(file.size)}</span>
                )}
                <button
                  type="button"
                  className="file-chip-remove"
                  onClick={() => removeAttachment(file.filename)}
                  title={t('chat.removeAttachment')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {isUploading && (
          <div className="attachment-status">
            <div className="spinner"></div>
            <span>{t('chat.uploading')}</span>
          </div>
        )}

        {uploadError && (
          <div className="attachment-error">{uploadError}</div>
        )}

        {busyElsewhere && (
          <div className="attachment-status">
            <div className="spinner"></div>
            <span>
              {t('chat.busyElsewhere')}
            </span>
          </div>
        )}

        <div className="ask-mode" role="radiogroup" aria-label={t('chat.whoAnswers')}>
          {ASK_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={askMode === option.id}
              className={`ask-mode-option ${askMode === option.id ? 'active' : ''}`}
              onClick={() => setAskMode(option.id)}
              disabled={isLoading}
              title={t(option.hintKey)}
            >
              <option.Icon size={14} />
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <div className="input-row">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.markdown,.txt,.csv,.tsv,.json,.jsonl,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.xml,.html,.css,.scss,.py,.js,.jsx,.ts,.tsx,.sh,.bash,.zsh,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.swift,.sql,.r,.lua,.pl,.pine,.diff,.patch,.ipynb"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || busyElsewhere || isUploading}
            title={t('chat.attachHint')}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Stacked documents: images and text files are both accepted */}
              <path d="M20 7h-3a2 2 0 0 1-2-2V2" />
              <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
              <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" />
            </svg>
          </button>
          <textarea
            className="message-input"
            placeholder={`${
              askMode === 'chairman' ? t('chat.askChairman') : t('chat.askCouncil')
            }  ·  ${t('chat.sendHint')}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading || busyElsewhere}
            rows={3}
          />
          <div className="send-group">
            <button type="submit" className="send-button" disabled={!canSend}>
              {t('chat.send')}
            </button>
            <span className="send-shortcut">({SEND_SHORTCUT})</span>
          </div>
        </div>
      </form>
    </div>
  );
}
