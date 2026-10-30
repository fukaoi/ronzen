import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import CouncilRoster from './CouncilRoster';
import { api } from '../api';
import './ChatInterface.css';

/**
 * Read a File as a base64 data URL.
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
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
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

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
          data_url: await readFileAsDataUrl(file),
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
      'Delete the last question and its answer? This cannot be undone.'
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
      attachedFiles.map(({ filename, name }) => ({ filename, name }))
    );
    setInput('');
    setAttachments([]);
    setUploadError(null);
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM COUNCIL2</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM COUNCIL2</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
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
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {index === lastUserIndex && canAmendLastTurn && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="message-action"
                        onClick={() => handleEditLastTurn(msg)}
                        title="Put this question back in the box to change it"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="message-action danger"
                        onClick={handleDeleteLastTurn}
                        title="Delete this question and its answer"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM COUNCIL2</div>

                  <CouncilRoster
                    members={msg.stage1?.map((resp) => resp.model)}
                    chairman={msg.stage3?.model}
                  />

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
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
              History carried into every question:{' '}
              <strong>
                {conversation.context_chars.toLocaleString()} characters
              </strong>
            </span>
            {conversation.context_heavy && (
              <>
                <span className="context-note">
                  Each question replays this to every council member twice and
                  to the chairman once, so it costs about seven times its size.
                </span>
                <button
                  type="button"
                  className="handoff-button"
                  onClick={onHandOff}
                  disabled={isLoading || busyElsewhere}
                >
                  Carry on in a new conversation
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
                  title="Remove attachment"
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
                  title="Remove attachment"
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
            <span>Uploading...</span>
          </div>
        )}

        {uploadError && (
          <div className="attachment-error">{uploadError}</div>
        )}

        {busyElsewhere && (
          <div className="attachment-status">
            <div className="spinner"></div>
            <span>
              Another conversation is still consulting the council. It keeps
              running - you can watch it from the sidebar.
            </span>
          </div>
        )}

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
            title="Attach images or text files (you can also drop or paste them)"
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
            placeholder="Ask your question...  ·  Enter to send, Shift+Enter for a new line"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading || busyElsewhere}
            rows={3}
          />
          <button type="submit" className="send-button" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
