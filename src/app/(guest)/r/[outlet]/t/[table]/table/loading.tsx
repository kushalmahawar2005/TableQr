export default function TableLoading() {
  return (
    <div aria-busy="true" aria-label="Loading your table" className="min-h-dvh pt-4">
      <div className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-card bg-line/60" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 animate-pulse rounded-input bg-line/60" />
          <div className="h-3 w-1/3 animate-pulse rounded-input bg-line/60" />
        </div>
      </div>
      <div className="mt-6 h-7 w-1/2 animate-pulse rounded-input bg-line/60" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-full bg-line/60" />
            <div className="h-4 w-2/5 animate-pulse rounded-input bg-line/60" />
          </div>
        ))}
      </div>
      <div className="mt-6 h-16 animate-pulse rounded-cta bg-line/60" />
      <div className="mt-3 h-16 animate-pulse rounded-guest bg-line/60" />
      <div className="mt-7 grid grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mx-auto size-11 animate-pulse rounded-card bg-line/60" />
        ))}
      </div>
    </div>
  );
}
