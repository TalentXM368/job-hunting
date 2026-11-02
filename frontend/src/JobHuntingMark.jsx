// Product mark for Job Hunting: a magnifier whose lens holds a check,
// "find the right one". Sits on the navy header, so the tile is teal.
export default function JobHuntingMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="jhm-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1fa394" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#jhm-g)" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="9.5" stroke="#ffffff" strokeOpacity="0.18" />
      <circle cx="18" cy="18" r="8.5" stroke="#f4f1ea" strokeWidth="2.6" />
      <path d="M24.5 24.5L31 31" stroke="#f4f1ea" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M14 18.2l2.7 2.7 5.3-5.6" stroke="#f4f1ea" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
