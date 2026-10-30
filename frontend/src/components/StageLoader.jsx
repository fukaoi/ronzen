import StageBadge from './StageBadge';

/** Pulsing stage badge with bouncing dots, shown while a stage is running. */
export default function StageLoader({ stage, children }) {
  return (
    <div className={`stage-loading stage${stage}`}>
      <span className="stage-loader-badge">
        <StageBadge stage={stage} />
      </span>
      <span>{children}</span>
      <span className="loading-dots" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </span>
    </div>
  );
}
