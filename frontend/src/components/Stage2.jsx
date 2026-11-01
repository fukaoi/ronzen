import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ModelIcon from './ModelIcon';
import StageBadge from './StageBadge';
import { useI18n } from '../i18n/useI18n';
import { shortName } from '../models';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = shortName(model);
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

/**
 * How far along the bar a model's average rank reaches: a unanimous 1st
 * fills it, a unanimous last leaves a sliver so every model stays visible.
 */
function rankStrength(averageRank, modelCount) {
  if (modelCount <= 1) return 1;
  const strength = (modelCount - averageRank) / (modelCount - 1);
  return Math.max(0.06, Math.min(1, strength));
}

export default function Stage2({ rankings, labelToModel, aggregateRankings }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  return (
    <div className="stage stage2">
      <h3 className="stage-title">
        <StageBadge stage={2} />
        {t('stage.2')}
      </h3>

      <h4>{t('stage.rawEvaluations')}</h4>
      <p className="stage-description">
        {t('stage.descBefore')}
        <strong>{t('stage.descBold')}</strong>
        {t('stage.descAfter')}
      </p>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <ModelIcon model={rank.model} size={16} />
            {shortName(rank.model)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">
          <ModelIcon model={rankings[activeTab].model} size={14} />
          {rankings[activeTab].model}
        </div>
        <div className="ranking-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {deAnonymizeText(rankings[activeTab].ranking, labelToModel)}
          </ReactMarkdown>
        </div>

        {rankings[activeTab].parsed_ranking &&
         rankings[activeTab].parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <strong>{t('stage.extracted')}</strong>
            <ol>
              {rankings[activeTab].parsed_ranking.map((label, i) => (
                <li key={i}>
                  {labelToModel && labelToModel[label] ? (
                    <span className="parsed-ranking-model">
                      <ModelIcon model={labelToModel[label]} size={14} />
                      {shortName(labelToModel[label])}
                    </span>
                  ) : (
                    label
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-rankings">
          <h4>{t('stage.aggregate')}</h4>
          <p className="stage-description">
            {t('stage.aggregateDesc')}
          </p>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div
                key={index}
                className="aggregate-item"
                style={{ '--rank-strength': rankStrength(agg.average_rank, aggregateRankings.length) }}
              >
                <span className="rank-position">{index + 1}</span>
                <ModelIcon model={agg.model} size={18} raised />
                <span className="rank-body">
                  <span className="rank-model">{shortName(agg.model)}</span>
                  <span className="rank-bar">
                    <span className="rank-bar-fill"></span>
                  </span>
                </span>
                <span className="rank-score">
                  {t('stage.avg', { value: agg.average_rank.toFixed(2) })}
                </span>
                <span className="rank-count">
                  {t('stage.votes', { n: agg.rankings_count })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
