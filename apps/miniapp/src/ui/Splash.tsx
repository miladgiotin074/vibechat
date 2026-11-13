/**
 * The loading screen: just a circular spinner, the way Android apps show it — an arc that grows
 * and shrinks while the whole ring turns (Material «indeterminate» progress).
 */
export function Splash() {
  return (
    <div className="grid h-full place-items-center bg-night">
      <svg className="md-spinner size-12 text-rose" viewBox="0 0 50 50" role="status" aria-label="در حال بارگذاری">
        <circle className="md-spinner-arc" cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
