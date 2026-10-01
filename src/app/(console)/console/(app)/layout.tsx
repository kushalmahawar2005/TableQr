import Link from "next/link";
import { consoleSections } from "@/lib/console-nav";

// Sidebar plus content, used by host, cashier, manager and owner screens.
export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <div className="flex flex-1">
      <aside className="hidden w-56 shrink-0 flex-col bg-ink px-3 py-5 text-white md:flex">
        <p className="px-3 font-display text-section font-medium">TableQR</p>
        <nav className="mt-6 flex flex-col gap-1">
          {consoleSections.map((s) => (
            <Link
              key={s.slug}
              href={`/console/${s.slug}`}
              className="rounded-input px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white"
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col bg-paper">{children}</div>
    </div>
  );
}
