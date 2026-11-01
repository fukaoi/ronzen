/** A torii gate, drawn to match lucide's 24px line icons. */
export default function ToriiIcon({ size = 24, strokeWidth = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.8 6.2 Q12 8.6 22.2 6.2" />
      <path d="M4 9.8 H20" />
      <path d="M6.2 9.8 V21.5" />
      <path d="M17.8 9.8 V21.5" />
      <path d="M3.4 14 H20.6" />
      <path d="M12 8.2 V14" />
    </svg>
  );
}
