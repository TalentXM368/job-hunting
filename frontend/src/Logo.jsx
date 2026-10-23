export default function Logo({ size = 36 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="8" fill="#12263a" />
      <path
        d="M11 9h9.2c3.6 0 6.1 2.1 6.1 5.2 0 2.2-1.2 3.9-3.2 4.7 2.4.7 3.9 2.6 3.9 5.1 0 3.4-2.7 5.5-6.6 5.5H11V9zm4.1 7.4h4.6c1.7 0 2.7-.9 2.7-2.2s-1-2.1-2.7-2.1h-4.6v4.3zm0 8.4h5.2c1.9 0 3-.9 3-2.3s-1.1-2.3-3-2.3h-5.2v4.6z"
        fill="#f4f1ea"
      />
    </svg>
  )
}
