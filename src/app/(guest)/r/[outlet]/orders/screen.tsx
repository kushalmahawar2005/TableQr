"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Package, CalendarDays, RefreshCw, Search } from "lucide-react";
import type { customerHistory } from "@/server/guest/customer-account";
import { useGuestBase } from "@/lib/guest-base";
import { customerAccountAction } from "../profile/actions";
import { trackCustomerOrderAction } from "./actions";
import { LanguageSwitch } from "../_components/guest-ui";
import { OutletLogo } from "../t/[table]/_components/outlet-logo";
import { useGuestExperience } from "../guest-shell";
import { shortOrderId, StatusView } from "../delivery/screen";

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const finished = (status: string) => ["delivered", "collected", "cancelled"].includes(status);
const statusLabel = (status: string, pickup: boolean, hindi: boolean) => {
  const labels: Record<string, string> = hindi
    ? { placed: "ऑर्डर मिल गया", dispatched: "रास्ते में", delivered: "डिलीवर हो गया", collected: "ले लिया गया", cancelled: "रद्द", draft: "पेमेंट बाकी" }
    : { placed: "Order received", dispatched: "On the way", delivered: "Delivered", collected: "Collected", cancelled: "Cancelled", draft: "Payment pending" };
  return labels[status] ?? (pickup ? (hindi ? "पिकअप ऑर्डर" : "Pickup order") : (hindi ? "डिलीवरी ऑर्डर" : "Delivery order"));
};
const COPY = {
  en: {
    back: "Back to orders", summary: "Order summary", bill: "Bill details", subtotal: "Item subtotal", discount: "Discount", tax: "Tax", deliveryCharge: "Delivery charge", serviceCharge: "Service charge", roundOff: "Round off", total: "Bill total", downloadBill: "Download bill", details: "Order details", orderId: "Order ID", copied: "Copied", copyFail: "Could not copy. You can select the Order ID.", payment: "Payment", paid: "Paid", pending: "Pending", payPickup: "Pay at pickup", payDelivery: "Pay on delivery", upi: "UPI QR", online: "Online payment", collectFrom: "Collect from", refund: "Refund", help: "Need help with this order?", reorderReview: "Order again · review cart", loadError: "Unable to load this order. Go back and try again.", loading: "Getting your order details…", titleBookings: "Orders & bookings", titleOrders: "Your orders", historyTitle: "Your favourites have a history", signInText: "Sign in with your verified phone to find your orders and bookings.", signIn: "Sign in", orders: "Orders", bookings: "Bookings", searchLabel: "Search your orders", searchPlaceholder: "Search dishes or Order ID", viewItems: "View order items", items: "items", viewDetails: "View details", track: "Track order", orderDetails: "Order details", orderAgain: "Order again", noMatch: "No matching orders", firstOrder: "Your first favourite is waiting", trySearch: "Try another dish name or Order ID.", afterOrder: "Once you place an order, you can follow it here.", explore: "Explore the menu →", party: "Party request", reservation: "Reservation", guests: "guests", noBookings: "No bookings yet. Verified bookings will appear here.", cancelled: "cancelled", requested: "requested", confirmed: "confirmed", seated: "seated", completed: "completed", expired: "expired", delivery: "Delivery", pickup: "Pickup", deliveryPickup: "Delivery & pickup", ordersWord: "orders", all: "All", active: "Active", past: "Past", activeOrders: "Active orders", pastOrders: "Past orders", reorder: "Reorder", notCharged: "Not charged", noPaymentDue: "No payment due", stale: "Older status saved. Refresh tracking or contact help for the latest.",
  },
  hi: {
    back: "ऑर्डर पर वापस जाएँ", summary: "ऑर्डर का सारांश", bill: "बिल की जानकारी", subtotal: "आइटम का कुल", discount: "छूट", tax: "टैक्स", deliveryCharge: "डिलीवरी शुल्क", serviceCharge: "सर्विस शुल्क", roundOff: "राउंड ऑफ़", total: "बिल का कुल", downloadBill: "बिल डाउनलोड करें", details: "ऑर्डर की जानकारी", orderId: "ऑर्डर आईडी", copied: "कॉपी हो गया", copyFail: "कॉपी नहीं हुआ। ऑर्डर आईडी को चुनकर कॉपी करें।", payment: "पेमेंट", paid: "भुगतान हो गया", pending: "बाकी", payPickup: "पिकअप पर पेमेंट", payDelivery: "डिलीवरी पर पेमेंट", upi: "UPI QR", online: "ऑनलाइन पेमेंट", collectFrom: "यहाँ से लें", refund: "रिफंड", help: "इस ऑर्डर में मदद चाहिए?", reorderReview: "फिर से ऑर्डर करें · कार्ट देखें", loadError: "ऑर्डर लोड नहीं हुआ। वापस जाकर फिर कोशिश करें।", loading: "ऑर्डर की जानकारी लोड हो रही है…", titleBookings: "ऑर्डर और बुकिंग", titleOrders: "आपके ऑर्डर", historyTitle: "आपके ऑर्डर यहाँ दिखेंगे", signInText: "अपने ऑर्डर और बुकिंग देखने के लिए सत्यापित फ़ोन से साइन इन करें।", signIn: "साइन इन करें", orders: "ऑर्डर", bookings: "बुकिंग", searchLabel: "अपने ऑर्डर खोजें", searchPlaceholder: "डिश या ऑर्डर आईडी खोजें", viewItems: "ऑर्डर के आइटम देखें", items: "आइटम", viewDetails: "जानकारी देखें", track: "ऑर्डर ट्रैक करें", orderDetails: "ऑर्डर की जानकारी", orderAgain: "फिर से ऑर्डर करें", noMatch: "कोई ऑर्डर नहीं मिला", firstOrder: "आपका पहला ऑर्डर यहाँ दिखेगा", trySearch: "दूसरी डिश या ऑर्डर आईडी खोजें।", afterOrder: "ऑर्डर देने के बाद उसकी स्थिति यहाँ देख सकेंगे।", explore: "मेन्यू देखें →", party: "पार्टी की पूछताछ", reservation: "टेबल बुकिंग", guests: "मेहमान", noBookings: "अभी कोई बुकिंग नहीं है। सत्यापित बुकिंग यहाँ दिखेंगी।", cancelled: "रद्द", requested: "अनुरोध मिला", confirmed: "पुष्टि हो गई", seated: "बैठ गए", completed: "पूरी हुई", expired: "समाप्त", delivery: "डिलीवरी", pickup: "पिकअप", deliveryPickup: "डिलीवरी और पिकअप", ordersWord: "ऑर्डर", all: "सभी", active: "चालू", past: "पुराने", activeOrders: "चालू ऑर्डर", pastOrders: "पुराने ऑर्डर", reorder: "फिर से ऑर्डर", notCharged: "पैसा नहीं लिया", noPaymentDue: "कोई पेमेंट बाकी नहीं", stale: "पुरानी स्थिति दिख रही है। नई जानकारी के लिए रिफ्रेश करें या मदद लें।",
  },
} as const;

type History = Awaited<ReturnType<typeof customerHistory>>;
type Order = NonNullable<History>["deliveries"][number];

export function CustomerOrders({ outlet, brandName, initial }: { outlet: string; brandName: string; initial: History | null }) {
  const base = useGuestBase(outlet);
  const query = useSearchParams();
  const { brand, language } = useGuestExperience();
  const hindi = language === "hi";
  const c = COPY[hindi ? "hi" : "en"];
  const locale = hindi ? "hi-IN-u-nu-latn" : "en-IN";
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"orders" | "bookings">(query.get("tab") === "bookings" && brand?.services.reservations ? "bookings" : "orders");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "active" | "past">("all");
  const [stale, setStale] = useState(false);
  const [tracking, setTracking] = useState<Extract<Awaited<ReturnType<typeof trackCustomerOrderAction>>, { ok: true }>["data"] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      const result = await customerAccountAction(outlet);
      if (!active) return;
      setStale(!result.ok);
      if (result.ok) setData(result.data);
      else if (result.error.includes("Sign in")) { setData(null); setSelected(null); setTracking(null); }
    };
    const timer = setInterval(() => void load(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [outlet]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      const result = await trackCustomerOrderAction(outlet, selected);
      if (!active) return;
      if (result.ok) { setTracking(result.data); setError(""); }
      else setError(result.error);
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => { active = false; clearInterval(timer); };
  }, [outlet, selected]);

  const selectedOrder = data?.deliveries.find((order) => order.id === selected);
  const select = (id: string) => { setSelected(id); setTracking(null); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const orders = (data?.deliveries ?? [])
    .filter((order) => `${order.id} ${order.items.map((item) => item.name).join(" ")} ${order.serviceMode}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(finished(a.status)) - Number(finished(b.status)) || b.at.localeCompare(a.at));

  const active = orders.filter((order) => !finished(order.status));
  const past = orders.filter((order) => finished(order.status));
  const allowedAgain = (order: Order) => brand?.services[order.serviceMode] ?? false;
  const againHref = (order: Order) => `${base}/delivery?new=1&mode=${order.serviceMode}&reorder=${encodeURIComponent(order.id)}`;
  const paymentLine = (order: Order) => {
    const method = order.paymentMode === "cod" ? (order.serviceMode === "pickup" ? c.payPickup : c.payDelivery) : order.paymentMode === "manual_qr" ? c.upi : c.online;
    if (order.status === "cancelled") return `${c.notCharged} · ${c.noPaymentDue}`;
    return `${order.paymentStatus === "paid" || order.status === "delivered" || order.status === "collected" ? c.paid : c.pending} · ${method}`;
  };
  const card = (order: Order) => {
    const live = !finished(order.status);
    const count = order.lines.reduce((n, line) => n + line.qty, 0);
    const first = order.items[0];
    return <article key={order.id} className="guest-card p-3.5">
      <div className="flex items-center justify-between gap-3"><b className={`text-sm ${live ? "text-brand" : ""}`}>{statusLabel(order.status, order.serviceMode === "pickup", hindi)}</b><b className="text-base tabular">{money(order.totalPaise)}</b></div>
      <button type="button" onClick={() => select(order.id)} aria-label={c.viewItems} className="mt-2.5 flex w-full cursor-pointer items-center gap-3 text-left">
        {first?.imageUrl ? <Image className="size-14 shrink-0 rounded-xl object-cover" src={first.imageUrl} alt="" width={56} height={56} unoptimized /> : <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-brand-soft"><Package size={20} className="text-muted" aria-hidden /></span>}
        <span className="min-w-0"><b className="block truncate text-sm">{order.items.length === 1 ? `${first.name} × ${first.qty}` : `${order.items.length || count} ${c.items} · ${order.serviceMode === "pickup" ? c.pickup : c.delivery}`}</b><span className="mt-0.5 block truncate text-sm text-muted">{new Date(order.at).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · {shortOrderId(order.id)}</span></span>
      </button>
      <p className="mt-2.5 text-sm text-muted">{paymentLine(order)}</p>
      {live ? <button type="button" onClick={() => select(order.id)} className="mt-3 min-h-12 w-full cursor-pointer rounded-xl bg-brand text-sm font-bold text-brand-on">{c.track}</button>
        : <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => select(order.id)} className={`min-h-12 cursor-pointer rounded-xl border border-line text-sm font-bold text-brand ${allowedAgain(order) ? "" : "col-span-2"}`}>{c.orderDetails}</button>
          {allowedAgain(order) && <Link href={againHref(order)} className="flex min-h-12 items-center justify-center rounded-xl border border-line text-sm font-bold text-brand">{c.reorder}</Link>}
        </div>}
    </article>;
  };
  const group = (title: string, list: Order[]) => list.length > 0 && <section className="mt-5"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold">{title}</h2><span className="text-sm text-muted tabular">{list.length}</span></div>
    {title === c.activeOrders && stale && <p className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-brand-soft p-3 text-sm"><RefreshCw size={18} className="shrink-0 text-brand" aria-hidden />{c.stale}</p>}
    <div className="mt-2.5 space-y-3">{list.map(card)}</div></section>;

  return (
    <main className="w-full min-w-0 pb-7 pt-5">
      {selected ? (
        <div className="guest-order-summary">
          {tracking ? <StatusView outletCode={outlet} status={tracking} hindi={hindi} pending={false} statusMessage={statusLabel(tracking.status, tracking.serviceMode === "pickup", hindi)} onBack={() => { setSelected(null); setTracking(null); }} reorderHref={selectedOrder && allowedAgain(selectedOrder) ? againHref(selectedOrder) : undefined} onRefresh={() => { void trackCustomerOrderAction(outlet, selected).then((result) => { if (result.ok) setTracking(result.data); else setError(result.error); }); }} newOrderHref={`${base}/delivery?new=1`} />
            : <><header className="guest-page-header"><button className="guest-icon-button" aria-label={c.back} onClick={() => { setSelected(null); setTracking(null); }}><ArrowLeft size={20} /></button><h1>{c.summary}</h1></header><div className="guest-card mt-5 p-6" role="status">{error ? c.loadError : c.loading}</div></>}
        </div>
      ) : <>
        <header className="flex items-center gap-3">
          <Link href={base} aria-label={brandName} className="flex min-w-0 flex-1 items-center gap-3">
            <OutletLogo name={brandName} logoUrl={brand?.outlet.logoUrl ?? null} size={44} />
            <span className="min-w-0"><b className="block truncate text-base leading-tight">{brandName}</b><span className="block truncate text-sm text-muted">{brand?.services.delivery && brand?.services.pickup ? c.deliveryPickup : brand?.services.pickup ? c.pickup : c.delivery}</span></span>
          </Link>
          <LanguageSwitch />
        </header>
        <div className="mt-4 flex items-baseline justify-between gap-3"><h1 className="font-display text-2xl font-bold tracking-tight">{tab === "orders" ? c.titleOrders : c.bookings}</h1>{data && tab === "orders" && <span className="text-sm text-muted tabular">{orders.length} {c.ordersWord}</span>}</div>
        {!data ? <section className="guest-card mt-3 p-7 text-center">
          <Package className="mx-auto mb-4 size-12 text-brand" />
          <h2 className="text-xl font-bold">{c.historyTitle}</h2>
          <p className="mt-2 text-sm text-muted">{c.signInText}</p>
          <Link href={`${base}/profile`} className="mt-5 block rounded-xl bg-brand p-3 font-bold text-brand-on">{c.signIn}</Link>
        </section> : <>
          {brand?.services.reservations && <div className="mt-3 flex gap-2 rounded-xl bg-surface p-1.5" role="tablist">
            {(["orders", "bookings"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-11 flex-1 rounded-lg text-sm font-bold ${tab === value ? "bg-brand text-brand-on" : "text-muted"}`}>{value === "orders" ? c.orders : c.bookings}</button>)}
          </div>}
          {tab === "orders" ? <>
            <label className="guest-search mt-3"><Search size={19} className="text-muted" /><input aria-label={c.searchLabel} placeholder={c.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={c.orders}>
              {([["all", c.all, orders.length], ["active", c.active, active.length], ["past", c.past, past.length]] as const).map(([key, label, n]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`min-h-11 cursor-pointer rounded-xl text-sm font-bold ${view === key ? "bg-brand-soft text-brand" : "bg-surface text-muted"}`}>{label} {n}</button>)}
            </div>
            {orders.length ? <>
              {view !== "past" && group(c.activeOrders, active)}
              {view !== "active" && group(c.pastOrders, past)}
              {(view === "active" ? active : view === "past" ? past : orders).length === 0 && <p className="guest-card mt-4 p-6 text-center text-sm text-muted">{c.noMatch}</p>}
            </> : <section className="guest-card mt-4 p-8 text-center"><Package className="mx-auto mb-3 size-10 text-muted" /><h2 className="font-bold">{search ? c.noMatch : c.firstOrder}</h2><p className="mt-2 text-sm text-muted">{search ? c.trySearch : c.afterOrder}</p>{!search && <Link href={base} className="mt-4 inline-block font-bold text-brand">{c.explore}</Link>}</section>}
          </> : <div className="mt-4 space-y-4">{data.bookings.length ? data.bookings.map((booking) => <article key={booking.id} className="guest-card p-5"><h2 className="flex items-center gap-2 font-bold"><CalendarDays size={19} />{booking.kind === "party" ? c.party : c.reservation}</h2><p className="mt-3 text-sm">{new Date(booking.startAt).toLocaleString(locale)}</p><p className="mt-2 text-xs text-muted">{booking.partySize} {c.guests} · {c[booking.status as keyof typeof c] ?? booking.status} · {booking.reference}</p></article>) : <p className="guest-card p-6 text-sm text-muted">{c.noBookings}</p>}</div>}
        </>}
      </>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-line bg-surface p-3 text-sm text-red-500">{error}</p>}
    </main>
  );
}
