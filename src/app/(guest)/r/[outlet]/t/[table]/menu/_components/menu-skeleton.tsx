/** Shaped like the menu: header, search, chips, a section of rows. Shown while the page streams. */
export function MenuSkeleton() {
  const bar = "animate-pulse rounded-md bg-line/60";
  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 pt-4">
        <div className={`size-10 rounded-card ${bar}`} />
        <div className="flex-1 space-y-1.5">
          <div className={`h-4 w-32 ${bar}`} />
          <div className={`h-3 w-24 ${bar}`} />
        </div>
        <div className={`h-9 w-20 rounded-full ${bar}`} />
      </div>
      <div className={`mt-3 h-12 rounded-input ${bar}`} />
      <div className="mt-3 flex gap-2">
        {[44, 48, 70, 50, 64].map((w) => (
          <div key={w} style={{ width: w }} className={`h-9 rounded-full ${bar}`} />
        ))}
      </div>
      <div className={`mt-6 h-5 w-24 ${bar}`} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 border-b border-line/70 py-4">
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-3/5 ${bar}`} />
            <div className={`h-4 w-14 ${bar}`} />
            <div className={`h-3 w-4/5 ${bar}`} />
          </div>
          <div className={`size-24 rounded-card ${bar}`} />
        </div>
      ))}
    </div>
  );
}
