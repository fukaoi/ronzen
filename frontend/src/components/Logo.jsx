/**
 * An ensō, the brush circle of Zen, drawn in sumi ink on a paper roundel,
 * with three vermilion dots of conversation inside: several minds talking
 * in one calm round. public/logo.svg is the same drawing, used as the favicon.
 */
export default function Logo({ size = 30, typing = false }) {
  return (
    <svg
      className={`logo ${typing ? 'typing' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Ronzen"
    >
      <circle cx="16" cy="16" r="15.5" fill="#f4eee0" stroke="#cdc2ab" strokeWidth="0.8" />
      <g fill="none" stroke="#2b2622" strokeLinecap="round">
        <path d="M22.43 8.34 A10 10 0 0 1 16 26" strokeWidth="4.2" />
        <path d="M21 24.66 A10 10 0 0 1 6.6 12.58" strokeWidth="3.2" />
        <path d="M6.15 17.74 A10 10 0 0 1 14.26 6.15" strokeWidth="2" />
      </g>
      <g fill="#c8362d">
        <circle className="logo-dot" cx="11.8" cy="16" r="1.8" />
        <circle className="logo-dot" cx="16" cy="16" r="1.8" />
        <circle className="logo-dot" cx="20.2" cy="16" r="1.8" />
      </g>
    </svg>
  );
}
