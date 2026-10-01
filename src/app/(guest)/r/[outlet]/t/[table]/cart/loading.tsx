/** Shaped like Your order while it loads */
export default function CartLoading() {
  const bar = "animate-pulse rounded-md bg-line/60";
  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 pt-3">
        <div className={`size-10 rounded-card ${bar}`} />
        <div className="flex-1 space-y-1.5">
          <div className={`h-4 w-32 ${bar}`} />
          <div className={`h-3 w-24 ${bar}`} />
        </div>
      </div>
      <div className={`mt-6 h-7 w-36 ${bar}`} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 border-b border-line/70 py-4">
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-3/5 ${bar}`} />
            <div className={`h-3 w-2/5 ${bar}`} />
          </div>
          <div className={`h-4 w-12 ${bar}`} />
        </div>
      ))}
    </div>
  );
}
