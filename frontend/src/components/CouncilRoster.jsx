import ModelIcon from './ModelIcon';
import { providerOf, shortName } from '../models';
import { useI18n } from '../i18n/useI18n';
import './CouncilRoster.css';

/**
 * Who sat on the council for this answer: one avatar per stage 1 member,
 * then the chairman once stage 3 has come back.
 */
export default function CouncilRoster({ members, chairman }) {
  const { t } = useI18n();

  if (!members || members.length === 0) {
    return null;
  }

  return (
    <div className="council-roster">
      <div className="roster-group">
        <span className="roster-caption">{t('roster.council')}</span>
        <div className="roster-members">
          {members.map((model) => (
            <div key={model} className="roster-member">
              <ModelIcon model={model} size={20} raised />
              <span className="roster-text">
                <span className="roster-name">{shortName(model)}</span>
                <span className="roster-provider">{providerOf(model).name}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {chairman && (
        <div className="roster-group roster-chair">
          <span className="roster-caption">{t('roster.chairman')}</span>
          <div className="roster-member">
            <span className="roster-crown">
              <ModelIcon model={chairman} size={20} raised />
            </span>
            <span className="roster-text">
              <span className="roster-name">{shortName(chairman)}</span>
              <span className="roster-provider">{providerOf(chairman).name}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
