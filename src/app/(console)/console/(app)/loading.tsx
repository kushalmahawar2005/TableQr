export default function ConsoleLoading() {
  return (
    <main className="mx-auto w-full max-w-[1100px] animate-pulse px-4 py-5 sm:px-6 lg:px-8 lg:py-7" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 rounded bg-ink/10" />
      <div className="mt-3 h-7 w-56 rounded bg-ink/10" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-card border border-line bg-surface" />)}</div>
      <div className="mt-4 h-56 rounded-card border border-line bg-surface" />
    </main>
  );
}
