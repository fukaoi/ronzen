import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from './Markdown';
import { Target, Users, Terminal, Flag } from 'lucide-react';
import ToriiIcon from './ToriiIcon';
import { useI18n } from '../i18n/useI18n';
import { LANGUAGES } from '../i18n/context';
import { api } from '../api';
import './MissionPanel.css';

// A goal is a whole brief, often with headings and lists: the first line
// stands in for it wherever a short name is needed
function missionTitle(goal) {
  const line = goal.split('\n').find((l) => l.trim()) || '';
  const title = line.replace(/^[#>\s*-]+/, '').replace(/\*\*/g, '').trim();
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

const INTRO_STEPS = [
  { Icon: Target, key: 'intro.step1' },
  { Icon: Users, key: 'intro.step2' },
  { Icon: Terminal, key: 'intro.step3' },
  { Icon: Flag, key: 'intro.step4' },
];

function MissionIntro() {
  const { t } = useI18n();

  return (
    <div className="mission-intro">
      <div className="mission-intro-head">
        <span className="mission-intro-badge">
          <ToriiIcon size={24} />
        </span>
        <div>
          <h3>{t('intro.title')}</h3>
          <p>
            {t('intro.text')}
          </p>
        </div>
      </div>
      <ol className="mission-intro-steps">
        {INTRO_STEPS.map((step, i) => (
          <li key={step.key}>
            <span className="mission-intro-icon">
              <step.Icon size={18} />
            </span>
            <div>
              <div className="mission-intro-title">
                <span className="mission-intro-num">{i + 1}</span>
                {t(`${step.key}.title`)}
              </div>
              <div className="mission-intro-text">{t(`${step.key}.text`)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The agent calls every couple of seconds while the council deliberates, but is
// silent while it works on a task, so a long quiet spell still counts as connected
const AGENT_CONNECTED_WITHIN = 15 * 60;

function isAgentConnected(seenAgo) {
  return seenAgo != null && seenAgo <= AGENT_CONNECTED_WITHIN;
}

function formatAgo(seconds, locale) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(-seconds, 'second');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  return rtf.format(-Math.floor(seconds / 3600), 'hour');
}

function AgentStatus({ seenAgo }) {
  const { t, lang } = useI18n();
  const connected = isAgentConnected(seenAgo);
  const locale = LANGUAGES.find((l) => l.code === lang)?.htmlLang;

  return (
    <>
      <div className={`agent-status ${connected ? 'connected' : ''}`}>
        <span className="agent-dot" aria-hidden="true" />
        {connected
          ? `${t('mission.agent.connected')} · ${formatAgo(seenAgo, locale)}`
          : t('mission.agent.notConnected')}
      </div>
      {connected && <p className="agent-note">{t('mission.agent.recopyNote')}</p>}
    </>
  );
}

function MissionText({ children }) {
  return (
    <div className="mission-text mission-markdown markdown-content">
      <Markdown>{children}</Markdown>
    </div>
  );
}

/**
 * What the coding agent is told to do. The tool names are the ones the MCP
 * server exposes; the agent's own rules and the user's stay above the council.
 */
function startPrompt(mission, t) {
  return t('mission.prompt', { id: mission.id });
}

function stateLabel(mission, t) {
  if (mission.step === 'running') return t('mission.state.deliberating');
  if (mission.step === 'error') return t('mission.state.failed');
  if (mission.status === 'active') {
    return mission.current_task
      ? t('mission.state.waitingAgent')
      : t('mission.state.waiting');
  }
  return t(`mission.status.${mission.status}`);
}

const STEP_MARKS = {
  done: '✓',
  current: '●',
  warn: '!',
  stopped: '■',
  pending: '',
};

/** Where one iteration stands. Only the latest one can still be in flight. */
function iterationState(mission, iteration, isLast, t) {
  if (!isLast) return { mark: 'done', label: t('mission.state.reported') };
  if (mission.step === 'error') {
    return { mark: 'warn', label: t('mission.state.failed') };
  }
  switch (mission.status) {
    case 'done':
      return { mark: 'done', label: t('mission.goalReached') };
    case 'limit':
      return { mark: 'warn', label: t('mission.state.limitReached') };
    case 'stopped':
      return { mark: 'stopped', label: t('mission.status.stopped') };
    case 'blocked':
      return { mark: 'warn', label: t('mission.state.needsDecision') };
    default:
      return iteration.report
        ? { mark: 'current', label: t('mission.state.judging') }
        : { mark: 'current', label: t('mission.state.waitingAgent') };
  }
}

/**
 * The iterations as a vertical timeline: the ones so far, then the next one
 * still to come. Later ones are folded into a single line, since the limit
 * can be as high as 30.
 */
function stepRows(mission, t) {
  const { iterations } = mission;
  const max = Number(mission.max_iterations);
  const isOpen = ['active', 'blocked'].includes(mission.status);

  const rows = iterations.map((it, i) => ({
    n: it.n,
    it,
    ...iterationState(mission, it, i === iterations.length - 1, t),
  }));

  // Before the first task exists the council is still drafting it
  if (rows.length === 0 && isOpen) {
    rows.push({
      n: 1,
      it: null,
      mark: mission.step === 'error' ? 'warn' : 'current',
      label:
        mission.step === 'error'
          ? t('mission.state.failed')
          : t('mission.state.drafting'),
    });
  }

  if (isOpen && rows.length < max) {
    rows.push({ n: rows.length + 1, it: null, mark: 'pending', label: '' });
    if (rows.length < max) {
      rows.push({
        n: max,
        it: null,
        mark: 'pending',
        label: t('mission.state.limit'),
      });
    }
  }
  return rows;
}

export default function MissionPanel() {
  const { t } = useI18n();
  const [missions, setMissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [goal, setGoal] = useState('');
  const [maxIterations, setMaxIterations] = useState(8);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      setMissions(await api.listMissions());
      if (selectedRef.current) {
        setDetail(await api.getMission(selectedRef.current));
      }
    } catch (e) {
      console.error('Failed to refresh missions:', e);
    }
  }, []);

  // The agent works on its own schedule, so keep looking
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setDetail(null);
    setReply('');
    if (selectedId) {
      api.getMission(selectedId).then(setDetail).catch(() => {});
    }
  }, [selectedId]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result) setDetail(result);
      await refresh();
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!goal.trim()) return;
    const created = await run(() =>
      api.createMission(goal.trim(), Number(maxIterations))
    );
    if (created) {
      setGoal('');
      setSelectedId(created.id);
    }
  };

  const connect = async () => {
    try {
      await navigator.clipboard.writeText(startPrompt(detail, t));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(t('mission.copyFailed'));
    }
  };

  const open = detail && ['active', 'blocked'].includes(detail.status);
  const agentConnected = open && isAgentConnected(detail.agent_seen_ago);

  return (
    <div className="mission-panel">
      <div className="mission-side">
        <h2 className="mission-heading">Missions β</h2>

        <div className="mission-card mission-form">
          <label>{t('mission.finalGoal')}</label>
          <textarea
            rows={3}
            value={goal}
            maxLength={4000}
            placeholder={t('mission.goalPlaceholder')}
            onChange={(e) => setGoal(e.target.value)}
          />
          <label>
            {t('mission.maxIterations')}
            <input
              type="number"
              min={1}
              max={30}
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.value)}
            />
          </label>
          <button
            className="mission-primary"
            disabled={busy || !goal.trim()}
            onClick={create}
          >
            {t('mission.start')}
          </button>
        </div>

        <div className="mission-list">
          {missions.length === 0 && (
            <div className="mission-empty">{t('mission.none')}</div>
          )}
          {missions.map((m) => (
            <div
              key={m.id}
              className={`mission-item ${m.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(m.id)}
            >
              <div className="mission-item-goal">{missionTitle(m.goal)}</div>
              <div className="mission-item-meta">
                <span className={`mission-badge ${m.status}`}>
                  {m.step === 'running'
                    ? t('mission.deliberating')
                    : t(`mission.status.${m.status}`)}
                </span>
                <span>
                  {m.iteration}/{m.max_iterations}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mission-main">
        {error && <div className="mission-error">{error}</div>}

        {!detail ? (
          <MissionIntro />
        ) : (
          <>
            <div className="mission-card">
              <div className="mission-title-row">
                <h3>{missionTitle(detail.goal)}</h3>
                <span className={`mission-badge ${detail.status}`}>
                  {t(`mission.status.${detail.status}`)}
                </span>
              </div>
              {detail.goal.trim() !== missionTitle(detail.goal) && (
                <details className="mission-goal">
                  <summary>{t('mission.fullGoal')}</summary>
                  <MissionText>{detail.goal}</MissionText>
                </details>
              )}
              {detail.criteria && (
                <p className="mission-criteria">{t('mission.doneWhen', { text: detail.criteria })}</p>
              )}
              <p className="mission-state">
                {t('mission.progress', {
                  state: stateLabel(detail, t),
                  n: detail.iterations.length,
                  max: detail.max_iterations,
                })}
              </p>

              <div className="mission-actions">
                {/* Once Claude is connected the prompt is only needed again if the
                    connection was lost, so the button steps back from primary */}
                <button
                  className={agentConnected ? '' : 'mission-primary'}
                  disabled={!open}
                  onClick={connect}
                >
                  {copied
                    ? t('common.copied')
                    : agentConnected
                      ? t('mission.agent.recopy')
                      : t('mission.connect')}
                </button>
                {detail.step === 'error' && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.retryMission(detail.id))}
                  >
                    {t('mission.retry')}
                  </button>
                )}
                {open && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.stopMission(detail.id))}
                  >
                    {t('mission.stop')}
                  </button>
                )}
              </div>
              {open && <AgentStatus seenAgo={detail.agent_seen_ago} />}
              {open && (
                <p className="mission-hint">
                  {t('mission.connectHint')}
                </p>
              )}
              {detail.step === 'error' && (
                <div className="mission-error">{detail.error}</div>
              )}
            </div>

            {detail.status === 'blocked' && (
              <div className="mission-card mission-blocked">
                <h4>{t('mission.blockedTitle')}</h4>
                <MissionText>{detail.summary}</MissionText>
                <textarea
                  rows={3}
                  value={reply}
                  placeholder={t('mission.yourAnswer')}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button
                  className="mission-primary"
                  disabled={busy || !reply.trim()}
                  onClick={async () => {
                    const result = await run(() =>
                      api.replyToMission(detail.id, reply.trim())
                    );
                    if (result) setReply('');
                  }}
                >
                  {t('mission.sendAnswer')}
                </button>
              </div>
            )}

            {['done', 'limit'].includes(detail.status) && detail.summary && (
              <div className="mission-card">
                <h4>
                  {detail.status === 'done'
                    ? t('mission.goalReached')
                    : t('mission.limitStopped')}
                </h4>
                <MissionText>{detail.summary}</MissionText>
              </div>
            )}

            <div className="mission-card">
              <h4>{t('mission.iterations')}</h4>
              <ol className="mission-steps">
                {stepRows(detail, t).map((row) => (
                  <li key={row.n} className={`mission-step ${row.mark}`}>
                    <span className="mission-step-mark">{STEP_MARKS[row.mark]}</span>
                    <div className="mission-step-body">
                      <div className="mission-step-title">
                        <span>{t('mission.iteration', { n: row.n })}</span>
                        <span className="mission-step-label">{row.label}</span>
                      </div>
                      {row.it && (
                        <details className="mission-step-detail">
                          <summary>{t('mission.taskAndReport')}</summary>
                          <div className="mission-label">{t('mission.taskFromCouncil')}</div>
                          <MissionText>{row.it.task}</MissionText>
                          <div className="mission-label">{t('mission.agentReport')}</div>
                          {row.it.report ? (
                            <MissionText>{row.it.report}</MissionText>
                          ) : (
                            <div className="mission-text">
                              <em>{t('mission.notReported')}</em>
                            </div>
                          )}
                          {row.it.notes?.map((note, i) => (
                            <div key={i}>
                              <div className="mission-label">{t('mission.yourAnswer')}</div>
                              <MissionText>{note}</MissionText>
                            </div>
                          ))}
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
