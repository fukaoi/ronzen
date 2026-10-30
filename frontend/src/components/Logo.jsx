/**
 * Two overlapping speech bubbles on the app's violet-to-teal gradient: models
 * talking it over. public/logo.svg is the same drawing, used as the favicon.
 */
export default function Logo({ size = 30, typing = false }) {
  return (
    <svg
      className={`logo ${typing ? 'typing' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="LLM Council2"
    >
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8257f5" />
          <stop offset="0.55" stopColor="#2f8df5" />
          <stop offset="1" stopColor="#0fb9a4" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#logo-gradient)" />
      <g fill="#fff" opacity="0.6">
        <rect x="13" y="13" width="14" height="10" rx="3.5" />
        <path d="M23 22.5 L24.5 27 L19 22.5 Z" />
      </g>
      <g fill="#fff">
        <rect x="5" y="6" width="16" height="12" rx="4" />
        <path d="M8 17.5 L8 23 L13.5 17.5 Z" />
      </g>
      <g fill="#6d5cf0">
        <circle className="logo-dot" cx="9.5" cy="12" r="1.3" />
        <circle className="logo-dot" cx="13" cy="12" r="1.3" />
        <circle className="logo-dot" cx="16.5" cy="12" r="1.3" />
      </g>
    </svg>
  );
}
