// The padlock Paper Lock shows: amber and shut while waiting, green with its shackle lifted when opened (paper.css).
export function LockIcon({ state, size = 96 }: { state: "locked" | "open"; size?: number }) {
  return (
    <svg className={`pl-lock ${state}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={state === "open" ? "Unlocked" : "Locked"}>
      <circle className="pl-ring" cx="32" cy="34" r="29" />
      <path className="pl-shackle" d="M21 29v-8a11 11 0 0 1 22 0v8" />
      <rect className="pl-body" x="14" y="29" width="36" height="25" rx="7" />
      <circle className="pl-key" cx="32" cy="40" r="3.2" />
      <path className="pl-key" d="M32 42.5v5" />
      <path className="pl-tick" d="m24 41.5 5.6 5.6L40 36" />
    </svg>
  );
}
