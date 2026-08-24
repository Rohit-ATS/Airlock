/**
 * The AIRLOCK mark: a sealed hatch seen head-on.
 *
 * An outer ring (the frame), an inner ring (the door), and a seam across the
 * middle. When a run is holding for a human the seam glows in the alarm colour
 * — the mark itself tells you the door is shut.
 */
export function Mark({ size = 18, sealed = false }: { size?: number; sealed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      <path
        d="M2.5 12h5.5M16 12h5.5"
        stroke={sealed ? 'var(--color-hazard)' : 'currentColor'}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* the four dogs that hold the hatch shut */}
      <circle cx="12" cy="4.4" r="1.05" fill="currentColor" opacity="0.75" />
      <circle cx="12" cy="19.6" r="1.05" fill="currentColor" opacity="0.75" />
      <circle cx="4.4" cy="12" r="1.05" fill="currentColor" opacity="0.75" />
      <circle cx="19.6" cy="12" r="1.05" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

export function Wordmark({ sealed }: { sealed?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-ink">
      <Mark size={17} sealed={sealed} />
      <span className="text-[13px] font-semibold tracking-[0.22em] select-none">AIRLOCK</span>
    </div>
  );
}
