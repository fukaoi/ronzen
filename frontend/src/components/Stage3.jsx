import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ModelIcon from './ModelIcon';
import StageBadge from './StageBadge';
import { shortName } from '../models';
import './Stage3.css';

export default function Stage3({ finalResponse, solo = false }) {
  const [copied, setCopied] = useState(false);

  if (!finalResponse) {
    return null;
  }

  const copyTarget = finalResponse.response;

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
      <h3 className="stage-title">
        <StageBadge stage={3} />
        {solo ? 'Chairman: Direct Answer' : 'Stage 3: Final Council Answer'}
      </h3>
      <div className="final-response">
        <div className="final-toolbar">
          <div className="chairman-label">
            <span className="chairman-icon">
              <ModelIcon model={finalResponse.model} size={14} />
            </span>
            Chairman: {shortName(finalResponse.model)}
          </div>

          <div className="final-actions">
            <button className={`copy-button ${copied ? 'copied' : ''}`} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="final-text markdown-content">
          <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
