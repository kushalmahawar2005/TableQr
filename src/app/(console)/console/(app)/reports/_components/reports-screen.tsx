"use client";

import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Banknote, ChefHat, Download, Lightbulb, Printer, Receipt, ShoppingBag, Timer, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Report } from "@/server/staff/reports-read";

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const short = (paise: number) => { const r = paise / 100; return r >= 100_000 ? `₹${(r / 100_000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(1)}K` : `₹${Math.round(r)}`; };
const day = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(v));
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const METHOD: Record<string, string> = { upi: "UPI", card: "Card", wallet: "Wallet", cash: "Cash" };
const SOURCE: Record<string, string> = { qr: "Scanned QR", walk_in: "Walk-in", reservation: "Booking", waitlist: "Waitlist" };
const PALETTE = ["var(--brand-main)", "#3d91ef", "#16c784", "#e9a23b", "#a78bfa", "#94a3b8", "#f472b6", "#22d3ee"];
const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / before) * 100));

const salesCfg = { sales: { label: "Sales (₹)", color: "var(--brand-main)" } } satisfies ChartConfig;
const hourCfg = { orders: { label: "Orders", color: "var(--brand-main)" } } satisfies ChartConfig;
const plainCfg = {} satisfies ChartConfig;

function Delta({ now, before, period }: { now: number; before: number; period: number }) {
  const c = change(now, before);
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
      {c === null ? <span className="font-semibold text-[#16a34a]">New</span>
        : c === 0 ? <span className="font-semibold">No change</span>
        : <span className={`flex items-center font-semibold ${c < 0 ? "text-danger" : "text-[#16a34a]"}`}>{c < 0 ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{Math.abs(c)}%</span>}
      vs previous {period} days
    </p>
  );
}

function Kpi({ icon: Icon, label, value, note, children }: { icon: typeof Users; label: string; value: string; note?: string; children?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong print:hidden"><Icon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{label}</p>
          <p className="truncate font-display text-2xl font-bold print:whitespace-normal leading-tight tabular-nums">{value}</p>
          {children ?? (note && <p className="mt-1 text-xs text-muted">{note}</p>)}
        </div>
      </CardContent>
    </Card>
  );
}

function BarList({ rows, empty }: { rows: { key: string; label: string; sub?: string; value: number; text: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate"><span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-ink/5 text-[11px] font-semibold text-muted">{i + 1}</span><span className="font-semibold">{r.label}</span>{r.sub && <span className="ml-1.5 text-xs text-muted">{r.sub}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums">{r.text}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/[0.06]"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Heatmap({ heat }: { heat: number[][] }) {
  const used = heat.flatMap((r) => r.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
  if (!used.length) return <p className="py-8 text-center text-sm text-muted">No orders yet. This map fills in as guests order.</p>;
  const max = Math.max(1, ...heat.flat());
  const lo = Math.min(...used), hi = Math.max(...used);
  const shown = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="no-scrollbar overflow-x-auto">
      <div className="min-w-[420px]">
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: `2.5rem repeat(${shown.length}, minmax(0, 1fr))` }}>
          <span />
          {shown.map((h) => <span key={h} className="text-center text-[10px] text-muted">{(h - lo) % 2 === 0 ? hour(h) : ""}</span>)}
          {heat.map((row, d) => (
            <div key={d} className="contents">
              <span className="text-xs font-semibold text-muted">{WEEKDAYS[d]}</span>
              {shown.map((h) => {
                const v = row[h];
                return <span key={h} title={`${WEEKDAYS_LONG[d]} ${hour(h)}: ${v} order${v === 1 ? "" : "s"}`} className="h-6 rounded-[5px] border border-line/60" style={{ background: v ? `color-mix(in srgb, var(--brand-main) ${Math.round(25 + (v / max) * 75)}%, transparent)` : "transparent" }} />;
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted">
          Quiet
          {[0.25, 0.45, 0.7, 1].map((o) => <span key={o} className="size-3.5 rounded-[4px]" style={{ background: `color-mix(in srgb, var(--brand-main) ${Math.round(o * 100)}%, transparent)` }} />)}
          Busy
        </div>
      </div>
    </div>
  );
}

export function ReportsScreen({ report, outlet }: { report: Report; outlet: string }) {
  const t = report.totals;
  const p = report.prev;
  const x = report.extras;
  const avg = t.bills ? Math.round(t.revenuePaise / t.bills) : 0;
  const prevAvg = p.bills ? Math.round(p.revenuePaise / p.bills) : 0;
  const peak = report.byHour.indexOf(Math.max(...report.byHour));
  const methodTotal = report.methods.reduce((n, m) => n + m.paise, 0);
  const catTotal = report.categories.reduce((n, c) => n + c.grossPaise, 0);
  const bestDay = report.weekday.reduce((b, d, i) => (d.revenuePaise > report.weekday[b].revenuePaise ? i : b), 0);
  const weekdayData = report.weekday.map((d, i) => ({ label: WEEKDAYS[i], sales: Math.round(d.revenuePaise / 100) }));
  const best = report.days.reduce((b, d) => (d.revenuePaise > b.revenuePaise ? d : b), report.days[0]);
  const dateRange = report.days.length ? `${day(report.days[0].date)} – ${day(report.days[report.days.length - 1].date)}` : `Last ${report.range} days`;
  const hasSales = t.revenuePaise > 0;
  const hasOrders = t.orders > 0;
  const top = report.topItems[0];
  const topMethod = report.methods[0];

  const insights: string[] = [];
  if (hasSales) insights.push(`${WEEKDAYS_LONG[bestDay]} is your best day. It brings in ${money(report.weekday[bestDay].revenuePaise)} of ${money(t.revenuePaise)}.`);
  if (hasOrders) insights.push(`Most orders come around ${hour(peak)}. Keep the kitchen and waiters ready at that time.`);
  if (top) insights.push(`${top.name} is your most ordered dish (${top.qty} sold). Keep it always in stock.`);
  if (hasSales && best.revenuePaise > 0) insights.push(`Best single day: ${day(best.date)} with ${money(best.revenuePaise)}.`);
  if (topMethod && methodTotal) insights.push(`${Math.round((topMethod.paise / methodTotal) * 100)}% of the money came by ${METHOD[topMethod.method] ?? topMethod.method}.`);
  if (x.voidedLines > 0) insights.push(`${x.voidedLines} item${x.voidedLines === 1 ? " was" : "s were"} cancelled after ordering (${money(x.voidedPaise)}). Check why, to cut waste.`);
  if (x.avgPrepMin !== null && x.avgPrepMin > 25) insights.push(`Food takes ${x.avgPrepMin} min on average to be ready. Guests may be waiting too long.`);

  const exportCsv = () => {
    const rows = [
      "Date,Orders,Paid bills,Net sales (INR)",
      ...report.days.map((d) => `${d.date},${d.orders},${d.bills},${Math.round(d.revenuePaise / 100)}`),
      "",
      "Dish,Qty sold,Sales (INR)",
      ...report.topItems.map((i) => `"${i.name.replace(/"/g, '""')}",${i.qty},${Math.round(i.grossPaise / 100)}`),
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `report-${report.range}d.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const trend = report.days.map((d) => ({ label: day(d.date), sales: Math.round(d.revenuePaise / 100) }));
  const hourData = report.byHour.map((v, h) => ({ label: hour(h), orders: v }));
  const first = hourData.findIndex((h) => h.orders > 0);
  const last = 23 - [...hourData].reverse().findIndex((h) => h.orders > 0);
  const chartHours = hasOrders ? hourData.slice(Math.max(0, first - 1), Math.min(24, last + 2)) : hourData;
  const busyHours = report.byHour.map((orders, h) => ({ h, orders })).filter((v) => v.orders > 0).sort((a, b) => b.orders - a.orders).slice(0, 6);

  return (
    <main id="reports-screen" className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7 print:max-w-none print:p-0">
      <div className="print:hidden">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">{outlet}</p>
          <h1 className="mt-1 font-display text-title font-bold text-ink">Reports</h1>
          <p className="mt-0.5 text-body text-muted">{dateRange} · {report.range} days</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Link href="/console/reports/day-close" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:border-ink/40"><Receipt className="size-4" aria-hidden="true" />Day close</Link>
          <Link href="/console/reports/gst" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:border-ink/40"><Receipt className="size-4" aria-hidden="true" />GST report</Link>
          <Link href="/console/reports/items" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink hover:border-ink/40"><Receipt className="size-4" aria-hidden="true" />Items &amp; staff</Link>
          <nav aria-label="Period" className="flex overflow-hidden rounded-xl border border-line bg-surface">
            {([7, 30, 90] as const).map((d) => (
              <Link key={d} href={`/console/reports?days=${d}`} aria-current={report.range === d ? "page" : undefined} className={`flex min-h-11 items-center px-3.5 text-sm font-semibold ${report.range === d ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>{d} days</Link>
            ))}
          </nav>
          <button type="button" onClick={exportCsv} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:border-ink/40"><Download className="size-4" aria-hidden="true" />Excel (CSV)</button>
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:border-ink/40"><Printer className="size-4" aria-hidden="true" />Print</button>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:[&>*]:min-w-0">
        <Kpi icon={TrendingUp} label="Total sales" value={money(t.revenuePaise)}><Delta now={t.revenuePaise} before={p.revenuePaise} period={report.range} /></Kpi>
        <Kpi icon={Receipt} label="Paid bills" value={String(t.bills)}><Delta now={t.bills} before={p.bills} period={report.range} /></Kpi>
        <Kpi icon={Banknote} label="Average bill" value={money(avg)}><Delta now={avg} before={prevAvg} period={report.range} /></Kpi>
        <Kpi icon={ShoppingBag} label="Orders" value={String(t.orders)}><Delta now={t.orders} before={p.orders} period={report.range} /></Kpi>
      </div>

      {insights.length > 0 && (
        <Card className="mt-4 border border-brand-border bg-brand-soft/40">
          <CardHeader className="pb-0"><CardTitle className="flex items-center gap-2 font-display text-section font-bold"><Lightbulb className="size-5 text-brand-strong" aria-hidden="true" />What to know</CardTitle></CardHeader>
          <CardContent><ul className="mt-2 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">{insights.slice(0, 6).map((s) => <li key={s} className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{s}</li>)}</ul></CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="font-display text-section font-bold">Sales every day</CardTitle>
          <CardDescription>{hasSales ? `Best day ${day(best.date)} · ${money(best.revenuePaise)}` : "Paid bills will show here."}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={salesCfg} className="h-60 w-full">
            <AreaChart data={trend} margin={{ left: -4, right: 8, top: 8 }}>
              <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-sales)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--color-sales)" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => short(v * 100)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="sales" type="monotone" stroke="var(--color-sales)" strokeWidth={2.5} fill="url(#salesFill)" />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 print:grid-cols-2 print:[&>*]:min-w-0 print:[&>*]:break-inside-avoid">
        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Best selling dishes</CardTitle><CardDescription>Most ordered first. Amount is before discount and tax.</CardDescription></CardHeader>
          <CardContent>
            <BarList empty="No dishes sold in this period." rows={report.topItems.slice(0, 8).map((i) => ({ key: i.name, label: i.name, sub: `× ${i.qty}`, value: i.qty, text: money(i.grossPaise) }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Sales by category</CardTitle><CardDescription>Which part of the menu earns the most.</CardDescription></CardHeader>
          <CardContent>
            {report.categories.length ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <ChartContainer config={plainCfg} className="aspect-square h-44 shrink-0">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie data={report.categories.map((c) => ({ name: c.name, value: Math.round(c.grossPaise / 100) }))} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} strokeWidth={2}>
                      {report.categories.map((c, i) => <Cell key={c.name} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="w-full min-w-0 space-y-2 text-sm">
                  {report.categories.map((c, i) => (
                    <li key={c.name} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate font-semibold">{c.name}</span></span>
                      <span className="shrink-0 tabular-nums text-muted">{catTotal ? Math.round((c.grossPaise / catTotal) * 100) : 0}% · {short(c.grossPaise)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="py-8 text-center text-sm text-muted">No sales yet.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 print:grid-cols-2 print:[&>*]:min-w-0 print:[&>*]:break-inside-avoid">
        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Which day sells most</CardTitle><CardDescription>{hasSales ? `${WEEKDAYS_LONG[bestDay]} is the strongest day.` : "Sales by day of the week."}</CardDescription></CardHeader>
          <CardContent>
            <ChartContainer config={salesCfg} className="h-48 w-full">
              <BarChart data={weekdayData} margin={{ left: -4, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => short(v * 100)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="sales" radius={[6, 6, 0, 0]}>{weekdayData.map((d, i) => <Cell key={d.label} fill="var(--color-sales)" fillOpacity={i === bestDay && hasSales ? 1 : 0.4} />)}</Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">How guests paid</CardTitle><CardDescription>{methodTotal ? `${money(methodTotal)} collected, tips included.` : "Payments will show here."}</CardDescription></CardHeader>
          <CardContent>
            <BarList empty="No payments in this period." rows={report.methods.map((m) => ({ key: m.method, label: METHOD[m.method] ?? m.method, sub: `${m.count} payment${m.count === 1 ? "" : "s"}`, value: m.paise, text: `${money(m.paise)} · ${methodTotal ? Math.round((m.paise / methodTotal) * 100) : 0}%` }))} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="font-display text-section font-bold">Busy times</CardTitle><CardDescription>{hasOrders ? `Busiest hour is ${hour(peak)}. Darker box means more orders.` : "Orders by day and time."}</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <Heatmap heat={report.heat} />
          {hasOrders && (
            <ChartContainer config={hourCfg} className="h-36 w-full">
              <BarChart data={chartHours} margin={{ left: -24, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" radius={[4, 4, 0, 0]}>{chartHours.map((d) => <Cell key={d.label} fill="var(--color-orders)" fillOpacity={d.label === hour(peak) ? 1 : 0.4} />)}</Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:[&>*]:min-w-0">
        <Kpi icon={Timer} label="Time guests stay" value={x.avgStayMin === null ? "—" : `${x.avgStayMin} min`} note={x.visits ? `${x.visits} table visit${x.visits === 1 ? "" : "s"} closed` : "No closed tables yet"} />
        <Kpi icon={ChefHat} label="Kitchen speed" value={x.avgPrepMin === null ? "—" : `${x.avgPrepMin} min`} note="Order placed to food ready" />
        <Kpi icon={Users} label="Guests served" value={String(x.covers)} note={x.covers && t.revenuePaise ? `${money(Math.round(t.revenuePaise / x.covers))} per guest` : "Counted when staff seat a party"} />
        <Kpi icon={ShoppingBag} label="Items sold" value={String(x.itemsSold)} note={x.voidedLines ? `${x.voidedLines} cancelled (${money(x.voidedPaise)})` : "Nothing cancelled"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 print:grid-cols-2 print:[&>*]:min-w-0 print:[&>*]:break-inside-avoid">
        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">Money breakdown</CardTitle><CardDescription>Where the paid bills add up.</CardDescription></CardHeader>
          <CardContent>
            <dl className="divide-y divide-line text-sm">
              {[["Total sales", money(t.revenuePaise)], ["Tax collected (GST)", money(t.taxPaise)], ["Service charge", money(x.serviceChargePaise)], ["Discounts given", money(x.discountPaise)], ["Tips", money(t.tipsPaise)]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-2.5"><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-display text-section font-bold">How guests arrived</CardTitle><CardDescription>Closed table visits by how the party sat down.</CardDescription></CardHeader>
          <CardContent>
            <BarList empty="No closed table visits yet." rows={x.bySource.map((s) => ({ key: s.source, label: SOURCE[s.source] ?? s.source, value: s.count, text: `${s.count} · ${x.visits ? Math.round((s.count / x.visits) * 100) : 0}%` }))} />
          </CardContent>
        </Card>
      </div>
      </div>

      <section id="reports-print" className="hidden text-black print:block" aria-label="Printable restaurant report">
        <header className="border-b-2 border-black pb-3">
          <p className="text-sm font-semibold">{outlet}</p>
          <h1 className="mt-1 text-2xl font-bold">Restaurant report</h1>
          <p className="mt-1 text-sm">{dateRange} · Sales, orders and operations · Amounts in INR</p>
        </header>

        <section className="mt-4" aria-label="Summary">
          <h2 className="text-base font-bold">Summary</h2>
          <table className="report-paper-table mt-2"><tbody>
            <tr><th>Total sales</th><td>{money(t.revenuePaise)}</td><th>Paid bills</th><td>{t.bills}</td></tr>
            <tr><th>Average bill</th><td>{money(avg)}</td><th>Orders</th><td>{t.orders}</td></tr>
            <tr><th>Guests served</th><td>{x.covers}</td><th>Items sold</th><td>{x.itemsSold}</td></tr>
            <tr><th>Tax collected</th><td>{money(t.taxPaise)}</td><th>Tips</th><td>{money(t.tipsPaise)}</td></tr>
            <tr><th>Discounts</th><td>{money(x.discountPaise)}</td><th>Service charge</th><td>{money(x.serviceChargePaise)}</td></tr>
          </tbody></table>
        </section>

        {insights.length > 0 && <section className="mt-4"><h2 className="text-base font-bold">Key findings</h2><ul className="mt-1 list-disc pl-5 text-sm">{insights.slice(0, 6).map((s) => <li key={s} className="py-0.5">{s}</li>)}</ul></section>}

        <section className="mt-4">
          <h2 className="text-base font-bold">Sales by day</h2>
          <table className="report-paper-table mt-2"><thead><tr><th>Date</th><th>Orders</th><th>Paid bills</th><th>Sales</th></tr></thead><tbody>
            {report.days.map((d) => <tr key={d.date}><td>{day(d.date)}</td><td>{d.orders}</td><td>{d.bills}</td><td>{money(d.revenuePaise)}</td></tr>)}
          </tbody></table>
        </section>

        <div className="mt-4 grid grid-cols-2 gap-5">
          <section><h2 className="text-base font-bold">Best selling dishes</h2><table className="report-paper-table mt-2"><thead><tr><th>Dish</th><th>Qty</th><th>Sales</th></tr></thead><tbody>
            {report.topItems.length ? report.topItems.map((i) => <tr key={i.name}><td>{i.name}</td><td>{i.qty}</td><td>{money(i.grossPaise)}</td></tr>) : <tr><td colSpan={3}>No dishes sold.</td></tr>}
          </tbody></table></section>
          <section><h2 className="text-base font-bold">Sales by category</h2><table className="report-paper-table mt-2"><thead><tr><th>Category</th><th>Qty</th><th>Sales</th><th>Share</th></tr></thead><tbody>
            {report.categories.length ? report.categories.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.qty}</td><td>{money(c.grossPaise)}</td><td>{catTotal ? Math.round((c.grossPaise / catTotal) * 100) : 0}%</td></tr>) : <tr><td colSpan={4}>No category sales.</td></tr>}
          </tbody></table></section>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-5">
          <section><h2 className="text-base font-bold">Payments received</h2><table className="report-paper-table mt-2"><thead><tr><th>Method</th><th>Payments</th><th>Amount</th></tr></thead><tbody>
            {report.methods.length ? report.methods.map((m) => <tr key={m.method}><td>{METHOD[m.method] ?? m.method}</td><td>{m.count}</td><td>{money(m.paise)}</td></tr>) : <tr><td colSpan={3}>No payments.</td></tr>}
          </tbody></table></section>
          <section><h2 className="text-base font-bold">Operations</h2><table className="report-paper-table mt-2"><tbody>
            <tr><th>Average table stay</th><td>{x.avgStayMin === null ? "—" : `${x.avgStayMin} min`}</td></tr>
            <tr><th>Average kitchen time</th><td>{x.avgPrepMin === null ? "—" : `${x.avgPrepMin} min`}</td></tr>
            <tr><th>Cancelled items</th><td>{x.voidedLines} · {money(x.voidedPaise)}</td></tr>
            <tr><th>Table visits closed</th><td>{x.visits}</td></tr>
          </tbody></table></section>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-5">
          <section><h2 className="text-base font-bold">Sales by weekday</h2><table className="report-paper-table mt-2"><thead><tr><th>Day</th><th>Paid bills</th><th>Sales</th></tr></thead><tbody>
            {report.weekday.map((d, i) => <tr key={WEEKDAYS[i]}><td>{WEEKDAYS_LONG[i]}</td><td>{d.bills}</td><td>{money(d.revenuePaise)}</td></tr>)}
          </tbody></table></section>
          <section><h2 className="text-base font-bold">Busiest hours</h2><table className="report-paper-table mt-2"><thead><tr><th>Time</th><th>Orders</th></tr></thead><tbody>
            {busyHours.length ? busyHours.map(({ h, orders }) => <tr key={h}><td>{hour(h)}</td><td>{orders}</td></tr>) : <tr><td colSpan={2}>No orders yet.</td></tr>}
          </tbody></table></section>
        </div>

        <section className="mt-4"><h2 className="text-base font-bold">How guests arrived</h2><table className="report-paper-table mt-2"><thead><tr><th>Visit source</th><th>Closed visits</th><th>Share</th></tr></thead><tbody>
          {x.bySource.length ? x.bySource.map((s) => <tr key={s.source}><td>{SOURCE[s.source] ?? s.source}</td><td>{s.count}</td><td>{x.visits ? Math.round((s.count / x.visits) * 100) : 0}%</td></tr>) : <tr><td colSpan={3}>No closed table visits.</td></tr>}
        </tbody></table></section>
      </section>
    </main>
  );
}
