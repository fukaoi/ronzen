import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
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

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
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

  // Clear the composer when switching conversations
  useEffect(() => {
    setInput('');
    setAttachments([]);
    setUploadError(null);
  }, [conversation?.id]);

  const addFiles = async (files) => {
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith('image/')
    );
    if (imageFiles.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const dataUrls = await Promise.all(imageFiles.map(readFileAsDataUrl));
      const uploaded = await api.uploadImages(dataUrls);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      console.error('Failed to upload images:', error);
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
      const hasImage = Array.from(e.clipboardData.files).some((file) =>
        file.type.startsWith('image/')
      );
      if (hasImage) {
        e.preventDefault();
        addFiles(e.clipboardData.files);
      }
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
    setAttachments((prev) => prev.filter((img) => img.filename !== filename));
  };

  const canSend =
    (input.trim() || attachments.length > 0) && !isLoading && !isUploading;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSend) return;

    onSendMessage(
      input,
      attachments.map((img) => img.filename)
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
          <h2>Welcome to LLM Council</h2>
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
            <p>Ask a question to consult the LLM Council</p>
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
                            href={api.imageUrl(filename)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={api.imageUrl(filename)}
                              alt="Attached image"
                            />
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
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

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
        {attachments.length > 0 && (
          <div className="attachment-previews">
            {attachments.map((img) => (
              <div key={img.filename} className="attachment-preview">
                <img src={api.imageUrl(img.filename)} alt="Attachment" />
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => removeAttachment(img.filename)}
                  title="Remove image"
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
            <span>Uploading image...</span>
          </div>
        )}

        {uploadError && (
          <div className="attachment-error">{uploadError}</div>
        )}

        <div className="input-row">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isUploading}
            title="Attach images (you can also drop or paste them)"
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
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="9" r="1.6" />
              <path d="M21 15.5 16 10.5 5.5 21" />
            </svg>
          </button>
          <textarea
            className="message-input"
            placeholder="Ask your question...  ·  Enter to send, Shift+Enter for a new line"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading}
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
