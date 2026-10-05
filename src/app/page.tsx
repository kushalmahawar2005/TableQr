import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ChefHat, CreditCard, LayoutDashboard, QrCode, Smartphone, Users, UtensilsCrossed } from "lucide-react";

export const metadata: Metadata = {
  title: "QR ordering, booking and billing for restaurants",
  description: "Guests scan, order and pay from the table. Your team runs the floor, kitchen and bills from one place.",
};

const steps = [
  { icon: QrCode, title: "Scan", text: "Guests scan the QR on the table. No app to install." },
  { icon: UtensilsCrossed, title: "Order", text: "They browse the menu, add dishes and send the order together." },
  { icon: CreditCard, title: "Pay", text: "Split the bill any way they like and pay by UPI or card." },
];

const features = [
  { icon: Smartphone, title: "Ordering from the table", text: "Hindi and English menu with photos, filters and group carts." },
  { icon: CalendarClock, title: "Bookings and waitlist", text: "Guests reserve a table or join the waitlist. You see it all on one calendar." },
  { icon: ChefHat, title: "Kitchen display", text: "Tickets reach the kitchen at once, with timers that show what is running late." },
  { icon: Users, title: "Waiter phone", text: "Waiters see their tables, requests and bills without walking back to the counter." },
  { icon: LayoutDashboard, title: "Owner dashboard", text: "Sales, orders and busy hours for every outlet at a glance." },
  { icon: CreditCard, title: "Split bills and refunds", text: "Pay for yourself, equally or custom. Refunds go back the same way." },
];

const links = [
  { href: "/console/login", label: "Restaurant sign in" },
  { href: "/kds", label: "Kitchen display" },
  { href: "/waiter", label: "Waiter app" },
  { href: "/admin", label: "Platform admin" },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <span className="grid size-9 place-items-center rounded-input bg-brand text-white" aria-hidden="true"><QrCode className="size-5" /></span>
          TableQR
        </Link>
        <Link href="/console/login" className="rounded-input border border-line bg-surface px-4 py-2 text-button font-semibold hover:bg-white">Sign in</Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-5 pb-14 pt-10 sm:pt-16 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
          <div>
            <p className="inline-block rounded-full bg-brand-soft px-3 py-1 text-caption font-semibold text-brand-strong">For restaurants and cafés</p>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">Scan. Order. Pay.<br /><span className="text-brand">Right from the table.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-muted">TableQR lets your guests order and pay from their phone, and gives your team one place to run the floor, the kitchen and the bills.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/r/SRJ01/t/HhK8" className="rounded-input bg-brand px-6 py-3 text-button font-bold text-white shadow-float hover:bg-brand-strong">Try the guest demo</Link>
              <Link href="/console/login" className="rounded-input border border-line bg-surface px-6 py-3 text-button font-bold hover:bg-white">Restaurant sign in</Link>
            </div>
            <p className="mt-4 text-caption text-muted">Want TableQR for your restaurant? Ask your TableQR contact to set up your account.</p>
          </div>

          <div className="mt-12 lg:mt-0" aria-hidden="true">
            <div className="mx-auto w-full max-w-xs rounded-[2rem] border border-line bg-surface p-3 shadow-modal">
              <div className="rounded-[1.5rem] bg-paper p-4">
                <p className="text-caption text-muted">Table 4</p>
                <p className="font-display text-section font-bold">Spice Route</p>
                <ul className="mt-4 space-y-2.5">
                  {[["Paneer Tikka", "₹260"], ["Butter Naan × 2", "₹120"], ["Masala Chai × 2", "₹100"]].map(([n, p]) => (
                    <li key={n} className="flex items-center justify-between rounded-input bg-surface px-3 py-2.5 text-body"><span>{n}</span><span className="font-semibold">{p}</span></li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between text-body"><span className="text-muted">Total</span><span className="font-display text-section font-bold">₹480</span></div>
                <div className="mt-3 rounded-input bg-brand py-3 text-center text-button font-bold text-white">Pay now</div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-5 py-14">
            <h2 className="font-display text-title font-bold sm:text-3xl">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="rounded-card border border-line bg-paper p-5">
                  <span className="grid size-11 place-items-center rounded-input bg-brand-soft text-brand"><s.icon className="size-5" aria-hidden="true" /></span>
                  <p className="mt-4 text-caption font-semibold text-muted">Step {i + 1}</p>
                  <h3 className="font-display text-section font-bold">{s.title}</h3>
                  <p className="mt-1 text-body text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-14">
          <h2 className="font-display text-title font-bold sm:text-3xl">Everything your team needs</h2>
          <p className="mt-2 max-w-2xl text-body text-muted">One system for guests, waiters, the kitchen and the owner.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <li key={f.title} className="rounded-card border border-line bg-surface p-5">
                <f.icon className="size-6 text-brand" aria-hidden="true" />
                <h3 className="mt-3 font-display text-section font-bold">{f.title}</h3>
                <p className="mt-1 text-body text-muted">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-16">
          <div className="rounded-[1.25rem] bg-ink px-6 py-10 text-center text-white sm:px-10">
            <h2 className="font-display text-title font-bold sm:text-3xl">Ready to see it work?</h2>
            <p className="mx-auto mt-2 max-w-md text-body text-white/70">Open the demo table on your phone and place an order.</p>
            <Link href="/r/SRJ01/t/HhK8" className="mt-6 inline-block rounded-input bg-brand px-6 py-3 text-button font-bold text-white hover:bg-brand-strong">Try the guest demo</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-6 text-caption text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} TableQR</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {links.map((l) => <Link key={l.href} href={l.href} className="hover:text-ink">{l.label}</Link>)}
          </nav>
        </div>
      </footer>
    </div>
  );
}
