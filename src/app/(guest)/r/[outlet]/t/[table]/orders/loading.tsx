export default function OrdersLoading() {
  return <div aria-busy="true" aria-label="Loading orders" className="min-h-dvh pt-4">
    <div className="h-10 w-3/4 animate-pulse rounded-input bg-line/60" />
    <div className="mt-7 h-6 w-40 animate-pulse rounded-input bg-line/60" />
    {[0, 1].map((n) => <div key={n} className="mt-5 space-y-5 rounded-guest border border-line bg-surface p-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded-input bg-line/60" />)}
    </div>)}
  </div>;
}
