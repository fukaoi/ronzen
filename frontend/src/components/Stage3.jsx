import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage3.css';

// Strip the markdown syntax so the text view (and its copy) is plain prose.
function toPlainText(markdown) {
  return markdown
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function Stage3({ finalResponse }) {
  const [viewMode, setViewMode] = useState('markdown');
  const [copied, setCopied] = useState(false);

  if (!finalResponse) {
    return null;
  }

  const plainText = toPlainText(finalResponse.response);
  const copyTarget = viewMode === 'markdown' ? finalResponse.response : plainText;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(copyTarget);
      } else {
        // Fallback for non-secure origins where the Clipboard API is unavailable
        const textarea = document.createElement('textarea');
        textarea.value = copyTarget;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="stage stage3">
      <h3 className="stage-title">Stage 3: Final Council Answer</h3>
      <div className="final-response">
        <div className="final-toolbar">
          <div className="chairman-label">
            Chairman: {finalResponse.model.split('/')[1] || finalResponse.model}
          </div>

          <div className="final-actions">
            <div className="view-toggle">
              <button
                className={`toggle-option ${viewMode === 'markdown' ? 'active' : ''}`}
                onClick={() => setViewMode('markdown')}
              >
                Markdown
              </button>
              <button
                className={`toggle-option ${viewMode === 'text' ? 'active' : ''}`}
                onClick={() => setViewMode('text')}
              >
                Text
              </button>
            </div>

            <button className={`copy-button ${copied ? 'copied' : ''}`} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {viewMode === 'markdown' ? (
          <div className="final-text markdown-content">
            <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
          </div>
        ) : (
          <pre className="final-text final-plain">{plainText}</pre>
        )}
      </div>
    </div>
  );
}
