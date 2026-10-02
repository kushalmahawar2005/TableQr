export default function PaidLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="min-h-dvh pt-4">
      <div className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-card bg-line/60" />
        <div className="h-4 w-2/5 animate-pulse rounded-input bg-line/60" />
      </div>
      <div className="mx-auto mt-10 size-16 animate-pulse rounded-full bg-line/60" />
      <div className="mx-auto mt-4 h-8 w-1/2 animate-pulse rounded-input bg-line/60" />
      <div className="mt-8 h-24 animate-pulse rounded-guest bg-line/60" />
      <div className="mt-4 h-24 animate-pulse rounded-guest bg-line/60" />
    </div>
  );
}
