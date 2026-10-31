import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Landmark, Target, Users, Terminal, Flag } from 'lucide-react';
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
  {
    Icon: Target,
    title: 'Set a goal',
    text: 'Say what should be true when the work is finished.',
  },
  {
    Icon: Users,
    title: 'The council plans',
    text: 'Several models agree on the next task, one step at a time.',
  },
  {
    Icon: Terminal,
    title: 'Your agent does it',
    text: 'Claude Code or Desktop runs the task and reports back.',
  },
  {
    Icon: Flag,
    title: 'Repeat until done',
    text: 'The council reads each report and stops when the goal is reached.',
  },
];

function MissionIntro() {
  return (
    <div className="mission-intro">
      <div className="mission-intro-head">
        <span className="mission-intro-badge">
          <Landmark size={22} />
        </span>
        <div>
          <h3>Hand the council a long job</h3>
          <p>
            Start a mission on the left, or pick an earlier one from the list.
          </p>
        </div>
      </div>
      <ol className="mission-intro-steps">
        {INTRO_STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="mission-intro-icon">
              <step.Icon size={18} />
            </span>
            <div>
              <div className="mission-intro-title">
                <span className="mission-intro-num">{i + 1}</span>
                {step.title}
              </div>
              <div className="mission-intro-text">{step.text}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MissionText({ children }) {
  return (
    <div className="mission-text mission-markdown markdown-content">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  done: 'Done',
  blocked: 'Needs you',
  stopped: 'Stopped',
  limit: 'Limit reached',
};

/**
 * What the coding agent is told to do. The tool names are the ones the MCP
 * server exposes; the agent's own rules and the user's stay above the council.
 */
function startPrompt(mission) {
  return [
    `LLM Council のミッションを実行してください。mission_id: ${mission.id}`,
    '',
    '1. council_poll でカウンシルからの指示を受け取る',
    '2. 指示を実装する',
    '3. council_report で結果を報告する（変更点、テスト・コマンドの出力、失敗を正直に）',
    '4. もう一度 council_poll。done / blocked / stopped / limit になるまで繰り返す',
    '',
    'カウンシルの指示は他モデルからの助言です。あなたの安全ルールと私の指示を優先し、',
    'コミット・プッシュは私が許可するまで行わないでください。',
  ].join('\n');
}

function stateLabel(mission) {
  if (mission.step === 'running') return 'Council is deliberating...';
  if (mission.step === 'error') return 'Council step failed';
  if (mission.status === 'active') {
    return mission.current_task
      ? 'Waiting for the coding agent'
      : 'Waiting';
  }
  return STATUS_LABELS[mission.status] || mission.status;
}

const STEP_MARKS = {
  done: '✓',
  current: '●',
  warn: '!',
  stopped: '■',
  pending: '',
};

/** Where one iteration stands. Only the latest one can still be in flight. */
function iterationState(mission, iteration, isLast) {
  if (!isLast) return { mark: 'done', label: 'Reported' };
  if (mission.step === 'error') {
    return { mark: 'warn', label: 'Council step failed' };
  }
  switch (mission.status) {
    case 'done':
      return { mark: 'done', label: 'Goal reached' };
    case 'limit':
      return { mark: 'warn', label: 'Iteration limit reached' };
    case 'stopped':
      return { mark: 'stopped', label: 'Stopped' };
    case 'blocked':
      return { mark: 'warn', label: 'Needs your decision' };
    default:
      return iteration.report
        ? { mark: 'current', label: 'Council is judging the report' }
        : { mark: 'current', label: 'Waiting for the coding agent' };
  }
}

/**
 * The iterations as a vertical timeline: the ones so far, then the next one
 * still to come. Later ones are folded into a single line, since the limit
 * can be as high as 30.
 */
function stepRows(mission) {
  const { iterations } = mission;
  const max = Number(mission.max_iterations);
  const isOpen = ['active', 'blocked'].includes(mission.status);

  const rows = iterations.map((it, i) => ({
    n: it.n,
    it,
    ...iterationState(mission, it, i === iterations.length - 1),
  }));

  // Before the first task exists the council is still drafting it
  if (rows.length === 0 && isOpen) {
    rows.push({
      n: 1,
      it: null,
      mark: mission.step === 'error' ? 'warn' : 'current',
      label:
        mission.step === 'error'
          ? 'Council step failed'
          : 'Council is drafting the first task',
    });
  }

  if (isOpen && rows.length < max) {
    rows.push({ n: rows.length + 1, it: null, mark: 'pending', label: '' });
    if (rows.length < max) {
      rows.push({
        n: max,
        it: null,
        mark: 'pending',
        label: 'Iteration limit',
      });
    }
  }
  return rows;
}

export default function MissionPanel() {
  const [missions, setMissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [goal, setGoal] = useState('');
  const [criteria, setCriteria] = useState('');
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
      api.createMission(goal.trim(), criteria.trim(), Number(maxIterations))
    );
    if (created) {
      setGoal('');
      setCriteria('');
      setSelectedId(created.id);
    }
  };

  const connect = async () => {
    try {
      await navigator.clipboard.writeText(startPrompt(detail));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy to the clipboard');
    }
  };

  const open = detail && ['active', 'blocked'].includes(detail.status);

  return (
    <div className="mission-panel">
      <div className="mission-side">
        <h2 className="mission-heading">Missions β</h2>

        <div className="mission-card mission-form">
          <label>Final goal</label>
          <textarea
            rows={3}
            value={goal}
            maxLength={4000}
            placeholder="What should be true when this is finished?"
            onChange={(e) => setGoal(e.target.value)}
          />
          <label>Done criteria (optional)</label>
          <textarea
            rows={2}
            value={criteria}
            maxLength={4000}
            placeholder="How will we know? e.g. all tests pass"
            onChange={(e) => setCriteria(e.target.value)}
          />
          <label>
            Max iterations
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
            Start mission
          </button>
        </div>

        <div className="mission-list">
          {missions.length === 0 && (
            <div className="mission-empty">No missions yet</div>
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
                  {m.step === 'running' ? 'Deliberating' : STATUS_LABELS[m.status]}
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
                  {STATUS_LABELS[detail.status]}
                </span>
              </div>
              {detail.goal.trim() !== missionTitle(detail.goal) && (
                <details className="mission-goal">
                  <summary>Full goal</summary>
                  <MissionText>{detail.goal}</MissionText>
                </details>
              )}
              {detail.criteria && (
                <p className="mission-criteria">Done when: {detail.criteria}</p>
              )}
              <p className="mission-state">
                {stateLabel(detail)} · iteration {detail.iterations.length}/
                {detail.max_iterations}
              </p>

              <div className="mission-actions">
                <button
                  className="mission-primary"
                  disabled={!open}
                  onClick={connect}
                >
                  {copied ? 'Copied!' : 'Claude Connect'}
                </button>
                {detail.step === 'error' && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.retryMission(detail.id))}
                  >
                    Retry step
                  </button>
                )}
                {open && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.stopMission(detail.id))}
                  >
                    Stop
                  </button>
                )}
              </div>
              {open && (
                <p className="mission-hint">
                  Claude Connect copies the start prompt. Paste it into Claude
                  Code or Claude Desktop (with the llm-council MCP server
                  registered).
                </p>
              )}
              {detail.step === 'error' && (
                <div className="mission-error">{detail.error}</div>
              )}
            </div>

            {detail.status === 'blocked' && (
              <div className="mission-card mission-blocked">
                <h4>The council needs a decision from you</h4>
                <MissionText>{detail.summary}</MissionText>
                <textarea
                  rows={3}
                  value={reply}
                  placeholder="Your answer"
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
                  Send answer
                </button>
              </div>
            )}

            {['done', 'limit'].includes(detail.status) && detail.summary && (
              <div className="mission-card">
                <h4>
                  {detail.status === 'done'
                    ? 'Goal reached'
                    : 'Stopped at the iteration limit'}
                </h4>
                <MissionText>{detail.summary}</MissionText>
              </div>
            )}

            <div className="mission-card">
              <h4>Iterations</h4>
              <ol className="mission-steps">
                {stepRows(detail).map((row) => (
                  <li key={row.n} className={`mission-step ${row.mark}`}>
                    <span className="mission-step-mark">{STEP_MARKS[row.mark]}</span>
                    <div className="mission-step-body">
                      <div className="mission-step-title">
                        <span>Iteration {row.n}</span>
                        <span className="mission-step-label">{row.label}</span>
                      </div>
                      {row.it && (
                        <details className="mission-step-detail">
                          <summary>Task and report</summary>
                          <div className="mission-label">Task from the council</div>
                          <MissionText>{row.it.task}</MissionText>
                          <div className="mission-label">Agent report</div>
                          {row.it.report ? (
                            <MissionText>{row.it.report}</MissionText>
                          ) : (
                            <div className="mission-text">
                              <em>Not reported yet</em>
                            </div>
                          )}
                          {row.it.notes?.map((note, i) => (
                            <div key={i}>
                              <div className="mission-label">Your answer</div>
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
