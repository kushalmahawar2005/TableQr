export default function FloorLoading() {
  return (
    <div aria-busy="true" aria-label="Loading floor" className="flex flex-1 flex-col">
      <div className="h-[61px] border-b border-line bg-surface" />
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-card border border-line bg-surface" />
          ))}
        </div>
        <div className="border-l border-line bg-surface" />
      </div>
    </div>
  );
}
