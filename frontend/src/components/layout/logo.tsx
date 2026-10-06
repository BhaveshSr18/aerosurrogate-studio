export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M5 18.5c4.5-6.5 13-8.2 22-4.2-7.8-.4-15.4 1.6-22 4.2Z" fill="#fff" />
      <path d="M5 22.5c6-2.4 13-3.2 22-2" stroke="#fff" strokeOpacity=".55" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M5 25.5c6-1.4 13-1.8 22-1" stroke="#fff" strokeOpacity=".3" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
