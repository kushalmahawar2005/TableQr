"use client";

import { useMemo, useState } from "react";
import { UNIT_LABEL } from "@/domain/inventory";
import { STOCK_LIBRARY } from "@/domain/stock-library";
import { libraryAction } from "../actions";
import { field, focus, primary, quiet, Sheet } from "./ui";

// The stock library: common kitchen raw materials grouped like a supplier's list. The owner ticks
// what they keep and adds them in one go; items already on their list are shown as added.

export function LibrarySheet({ have, onClose, done }: { have: string[]; onClose: () => void; done: (message: string) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = useMemo(() => new Set(have.map((n) => n.toLowerCase())), [have]);
  const q = query.trim().toLowerCase();
  const groups = STOCK_LIBRARY.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.name.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)) })).filter((g) => g.items.length);

  const toggle = (name: string) => setPicked((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const toggleGroup = (names: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const x of names) if (on) n.add(x); else n.delete(x); return n; });

  const save = async () => {
    setBusy(true); setError(null);
    const r = await libraryAction([...picked]);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await done(`${r.data.added} ${r.data.added === 1 ? "item" : "items"} added${r.data.skipped ? ` (${r.data.skipped} were already on your list)` : ""}. Save a purchase bill to put stock in.`);
  };

  return (
    <Sheet title="Add from library" onClose={onClose} wide>
      <p className="text-body text-muted">Tick what your kitchen buys. Units, groups and pack sizes are filled in; you can change any of them later.</p>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. paneer, dal, oil" aria-label="Search the library" className={`${field} mt-3`} />
      <div className="mt-3 max-h-[52dvh] space-y-4 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="py-6 text-center text-body text-muted">Nothing matches. Use “+ Stock item” to add it yourself.</p>}
        {groups.map((g) => {
          const free = g.items.filter((i) => !owned.has(i.name.toLowerCase())).map((i) => i.name);
          const all = free.length > 0 && free.every((n) => picked.has(n));
          return (
            <section key={g.group}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">{g.group}</h3>
                {free.length > 0 && <button type="button" className={`text-caption font-semibold text-ink underline-offset-2 hover:underline ${focus}`} onClick={() => toggleGroup(free, !all)}>{all ? "Clear" : "Tick all"}</button>}
              </div>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((i) => {
                  const added = owned.has(i.name.toLowerCase());
                  const on = picked.has(i.name);
                  return (
                    <label key={i.name} className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-body ${added ? "cursor-default border-line opacity-55" : on ? "border-ink bg-ink/[0.04]" : "border-line hover:border-ink/40"}`}>
                      <input type="checkbox" className="size-4 shrink-0 accent-[var(--ink)]" checked={added || on} disabled={added} onChange={() => toggle(i.name)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{i.name}</span>
                        <span className="block text-caption text-muted">{added ? "Already added" : `${UNIT_LABEL[i.unit]}${i.pack ? ` · 1 ${i.pack.name} = ${i.pack.size}` : ""}`}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-body text-muted">{picked.size} ticked</p>
        <div className="flex gap-2">
          {picked.size > 0 && <button type="button" className={`${quiet} min-h-11`} onClick={() => setPicked(new Set())}>Clear all</button>}
          <button type="button" className={primary} disabled={busy || picked.size === 0} onClick={() => void save()}>{busy ? "Adding…" : `Add ${picked.size || ""} ${picked.size === 1 ? "item" : "items"}`}</button>
        </div>
      </div>
    </Sheet>
  );
}
