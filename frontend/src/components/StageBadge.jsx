import { MessagesSquare, Scale, Crown } from 'lucide-react';

const STAGE_ICONS = {
  1: MessagesSquare,
  2: Scale,
  3: Crown,
};

export default function StageBadge({ stage, size = 17 }) {
  const Icon = STAGE_ICONS[stage];
  return (
    <span className="stage-badge" aria-hidden="true">
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}
