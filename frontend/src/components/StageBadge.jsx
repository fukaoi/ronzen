import { MessagesSquare, Scale, Stamp } from 'lucide-react';

const STAGE_ICONS = {
  1: MessagesSquare,
  2: Scale,
  3: Stamp,
};

export default function StageBadge({ stage, size = 17 }) {
  const Icon = STAGE_ICONS[stage];
  return (
    <span className="stage-badge" aria-hidden="true">
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}
