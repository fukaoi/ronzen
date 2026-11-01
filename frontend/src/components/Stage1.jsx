import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ModelIcon from './ModelIcon';
import StageBadge from './StageBadge';
import { useI18n } from '../i18n/useI18n';
import { shortName } from '../models';
import './Stage1.css';

export default function Stage1({ responses }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

  return (
    <div className="stage stage1">
      <h3 className="stage-title">
        <StageBadge stage={1} />
        {t('stage.1')}
      </h3>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <ModelIcon model={resp.model} size={16} />
            {shortName(resp.model)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">
          <ModelIcon model={responses[activeTab].model} size={14} />
          {responses[activeTab].model}
        </div>
        <div className="response-text markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{responses[activeTab].response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
