export default function BillLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the bill" className="min-h-dvh pt-4">
      <div className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-card bg-line/60" />
        <div className="h-4 w-2/5 animate-pulse rounded-input bg-line/60" />
      </div>
      <div className="mt-6 h-7 w-1/4 animate-pulse rounded-input bg-line/60" />
      <div className="mt-4 h-20 animate-pulse rounded-guest bg-line/60" />
      <div className="mt-6 h-12 animate-pulse rounded-cta bg-line/60" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-6 animate-pulse rounded-input bg-line/60" />
        ))}
      </div>
      <div className="mt-6 h-40 animate-pulse rounded-guest bg-line/60" />
      <div className="mt-6 h-14 animate-pulse rounded-cta bg-line/60" />
    </div>
  );
}
