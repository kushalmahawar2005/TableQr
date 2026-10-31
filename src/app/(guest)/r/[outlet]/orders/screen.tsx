"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package, CalendarDays, RefreshCw, Search, Check, ChevronRight, ArrowLeft, Copy, Download, Headphones, ShoppingBag, Truck } from "lucide-react";
import type { customerHistory } from "@/server/guest/customer-account";
import { useGuestBase } from "@/lib/guest-base";
import { customerAccountAction } from "../profile/actions";
import { trackCustomerOrderAction } from "./actions";
import { GuestHeader } from "../_components/guest-ui";
import { useGuestExperience } from "../guest-shell";
import { StatusView } from "../delivery/screen";

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
    back: "Back to orders", summary: "Order summary", bill: "Bill details", subtotal: "Item subtotal", discount: "Discount", tax: "Tax", deliveryCharge: "Delivery charge", serviceCharge: "Service charge", roundOff: "Round off", total: "Bill total", downloadBill: "Download bill", details: "Order details", orderId: "Order ID", copied: "Copied", copyFail: "Could not copy. You can select the Order ID.", payment: "Payment", paid: "Paid", pending: "Pending", payPickup: "Pay at pickup", payDelivery: "Pay on delivery", upi: "UPI QR", online: "Online payment", collectFrom: "Collect from", refund: "Refund", help: "Need help with this order?", reorderReview: "Order again · review cart", loadError: "Unable to load this order. Go back and try again.", loading: "Getting your order details…", titleBookings: "Orders & bookings", titleOrders: "Your orders", historyTitle: "Your favourites have a history", signInText: "Sign in with your verified phone to find your orders and bookings.", signIn: "Sign in", orders: "Orders", bookings: "Bookings", searchLabel: "Search your orders", searchPlaceholder: "Search dishes or Order ID", viewItems: "View order items", items: "items", viewDetails: "View details", track: "Track order", orderDetails: "Order details", orderAgain: "Order again", noMatch: "No matching orders", firstOrder: "Your first favourite is waiting", trySearch: "Try another dish name or Order ID.", afterOrder: "Once you place an order, you can follow it here.", explore: "Explore the menu →", party: "Party request", reservation: "Reservation", guests: "guests", noBookings: "No bookings yet. Verified bookings will appear here.", cancelled: "cancelled", requested: "requested", confirmed: "confirmed", seated: "seated", completed: "completed", expired: "expired", delivery: "Delivery", pickup: "Pickup",
  },
  hi: {
    back: "ऑर्डर पर वापस जाएँ", summary: "ऑर्डर का सारांश", bill: "बिल की जानकारी", subtotal: "आइटम का कुल", discount: "छूट", tax: "टैक्स", deliveryCharge: "डिलीवरी शुल्क", serviceCharge: "सर्विस शुल्क", roundOff: "राउंड ऑफ़", total: "बिल का कुल", downloadBill: "बिल डाउनलोड करें", details: "ऑर्डर की जानकारी", orderId: "ऑर्डर आईडी", copied: "कॉपी हो गया", copyFail: "कॉपी नहीं हुआ। ऑर्डर आईडी को चुनकर कॉपी करें।", payment: "पेमेंट", paid: "भुगतान हो गया", pending: "बाकी", payPickup: "पिकअप पर पेमेंट", payDelivery: "डिलीवरी पर पेमेंट", upi: "UPI QR", online: "ऑनलाइन पेमेंट", collectFrom: "यहाँ से लें", refund: "रिफंड", help: "इस ऑर्डर में मदद चाहिए?", reorderReview: "फिर से ऑर्डर करें · कार्ट देखें", loadError: "ऑर्डर लोड नहीं हुआ। वापस जाकर फिर कोशिश करें।", loading: "ऑर्डर की जानकारी लोड हो रही है…", titleBookings: "ऑर्डर और बुकिंग", titleOrders: "आपके ऑर्डर", historyTitle: "आपके ऑर्डर यहाँ दिखेंगे", signInText: "अपने ऑर्डर और बुकिंग देखने के लिए सत्यापित फ़ोन से साइन इन करें।", signIn: "साइन इन करें", orders: "ऑर्डर", bookings: "बुकिंग", searchLabel: "अपने ऑर्डर खोजें", searchPlaceholder: "डिश या ऑर्डर आईडी खोजें", viewItems: "ऑर्डर के आइटम देखें", items: "आइटम", viewDetails: "जानकारी देखें", track: "ऑर्डर ट्रैक करें", orderDetails: "ऑर्डर की जानकारी", orderAgain: "फिर से ऑर्डर करें", noMatch: "कोई ऑर्डर नहीं मिला", firstOrder: "आपका पहला ऑर्डर यहाँ दिखेगा", trySearch: "दूसरी डिश या ऑर्डर आईडी खोजें।", afterOrder: "ऑर्डर देने के बाद उसकी स्थिति यहाँ देख सकेंगे।", explore: "मेन्यू देखें →", party: "पार्टी की पूछताछ", reservation: "टेबल बुकिंग", guests: "मेहमान", noBookings: "अभी कोई बुकिंग नहीं है। सत्यापित बुकिंग यहाँ दिखेंगी।", cancelled: "रद्द", requested: "अनुरोध मिला", confirmed: "पुष्टि हो गई", seated: "बैठ गए", completed: "पूरी हुई", expired: "समाप्त", delivery: "डिलीवरी", pickup: "पिकअप",
  },
} as const;

type History = Awaited<ReturnType<typeof customerHistory>>;

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
  const [copied, setCopied] = useState(false);
  const [tracking, setTracking] = useState<Extract<Awaited<ReturnType<typeof trackCustomerOrderAction>>, { ok: true }>["data"] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      const result = await customerAccountAction(outlet);
      if (!active) return;
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
  const select = (id: string) => { setSelected(id); setTracking(null); setCopied(false); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const orders = (data?.deliveries ?? [])
    .filter((order) => `${order.id} ${order.items.map((item) => item.name).join(" ")} ${order.serviceMode}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(finished(a.status)) - Number(finished(b.status)) || b.at.localeCompare(a.at));

  return (
    <main className="pb-7">
      {selected ? (
        <div className="guest-order-summary">
          <header className="guest-page-header">
            <button className="guest-icon-button" aria-label={c.back} onClick={() => { setSelected(null); setTracking(null); }}><ArrowLeft size={20} /></button>
            <h1>{c.summary}</h1>
            {tracking?.billPdfUrl && <a className="guest-icon-button" aria-label={c.downloadBill} href={tracking.billPdfUrl}><Download size={19} /></a>}
          </header>
          <p className="text-lg font-extrabold">{brandName}</p>
          {selectedOrder && <p className="mt-1 text-xs text-muted">{new Date(selectedOrder.at).toLocaleString(locale)}</p>}
          {tracking ? <>
            <StatusView outletCode={outlet} status={tracking} hindi={hindi} pending={false} statusMessage={statusLabel(tracking.status, tracking.serviceMode === "pickup", hindi)} onRefresh={() => { void trackCustomerOrderAction(outlet, selected).then((result) => { if (result.ok) setTracking(result.data); else setError(result.error); }); }} newOrderHref={`${base}/delivery?new=1`} />
            {tracking.billBreakdown && <section className="guest-card mt-4 p-5">
              <h2 className="mb-4 font-bold">{c.bill}</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt>{c.subtotal}</dt><dd>{money(tracking.billBreakdown.subtotalPaise)}</dd></div>
                {tracking.billBreakdown.discountPaise > 0 && <div className="flex justify-between text-brand"><dt>{c.discount}</dt><dd>−{money(tracking.billBreakdown.discountPaise)}</dd></div>}
                {tracking.billBreakdown.taxPaise > 0 && <div className="flex justify-between"><dt>{c.tax}</dt><dd>{money(tracking.billBreakdown.taxPaise)}</dd></div>}
                {tracking.deliveryFeePaise > 0 && <div className="flex justify-between"><dt>{c.deliveryCharge}</dt><dd>{money(tracking.deliveryFeePaise)}</dd></div>}
                {tracking.billBreakdown.serviceChargePaise > 0 && <div className="flex justify-between"><dt>{c.serviceCharge}</dt><dd>{money(tracking.billBreakdown.serviceChargePaise)}</dd></div>}
                {tracking.billBreakdown.roundOffPaise !== 0 && <div className="flex justify-between"><dt>{c.roundOff}</dt><dd>{money(tracking.billBreakdown.roundOffPaise)}</dd></div>}
                <div className="flex justify-between border-t border-line pt-3 font-bold"><dt>{c.total}</dt><dd>{money(tracking.totalPaise)}</dd></div>
              </dl>
              <a className="mt-4 flex min-h-11 items-center gap-2 text-sm font-bold text-brand" href={tracking.billPdfUrl ?? undefined}><Download size={16} />{c.downloadBill}</a>
            </section>}
            <section className="guest-card mt-4 space-y-4 p-5">
              <h2 className="font-bold">{c.details}</h2>
              <div><p className="text-xs text-muted">{c.orderId}</p><button className="flex min-h-11 max-w-full items-center gap-2 break-all text-left text-xs font-semibold" onClick={() => { void navigator.clipboard.writeText(tracking.id).then(() => setCopied(true), () => setError(c.copyFail)); }}>{tracking.id}<Copy size={15} className="shrink-0" /></button>{copied && <span role="status" className="text-xs text-brand">{c.copied}</span>}</div>
              <div><p className="text-xs text-muted">{c.payment}</p><p className="mt-1 text-sm font-semibold">{tracking.paid ? c.paid : c.pending} · {tracking.paymentMode === "cod" ? (tracking.serviceMode === "pickup" ? c.payPickup : c.payDelivery) : tracking.paymentMode === "manual_qr" ? c.upi : c.online}</p></div>
              {tracking.serviceMode === "pickup" && brand?.outlet.address && <div><p className="text-xs text-muted">{c.collectFrom}</p><p className="mt-1 text-sm">{brand.outlet.address}, {brand.outlet.city}</p></div>}
              {tracking.refundStatus && tracking.refundStatus !== "none" && <p className="text-sm">{c.refund}: {tracking.refundStatus.replaceAll("_", " ")}</p>}
            </section>
            {brand?.outlet.phone && <a href={`tel:${brand.outlet.phone}`} className="guest-card mt-4 flex min-h-14 items-center gap-3 p-4 text-sm font-bold"><Headphones size={19} />{c.help}<ChevronRight className="ml-auto" size={16} /></a>}
            {selectedOrder && finished(selectedOrder.status) && (brand?.services[selectedOrder.serviceMode] ?? false) && <Link href={`${base}/delivery?new=1&mode=${selectedOrder.serviceMode}&reorder=${encodeURIComponent(selectedOrder.id)}`} className="mt-5 flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-brand p-3 font-bold text-brand-on"><RefreshCw size={17} />{c.reorderReview}</Link>}
          </> : <div className="guest-card mt-5 p-6" role="status">{error ? c.loadError : c.loading}</div>}
        </div>
      ) : <>
        <GuestHeader outlet={outlet} title={brand?.services.reservations ? c.titleBookings : c.titleOrders} />
        {!data ? <section className="guest-card mt-3 p-7 text-center">
          <Package className="mx-auto mb-4 size-12 text-brand" />
          <h2 className="text-xl font-bold">{c.historyTitle}</h2>
          <p className="mt-2 text-sm text-muted">{c.signInText}</p>
          <Link href={`${base}/profile`} className="mt-5 block rounded-xl bg-brand p-3 font-bold text-brand-on">{c.signIn}</Link>
        </section> : <>
          {brand?.services.reservations && <div className="mb-4 flex gap-2 rounded-xl bg-surface p-1.5" role="tablist">
            {(["orders", "bookings"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-11 flex-1 rounded-lg text-sm font-bold ${tab === value ? "bg-brand text-brand-on" : "text-muted"}`}>{value === "orders" ? c.orders : c.bookings}</button>)}
          </div>}
          {tab === "orders" && <label className="guest-search"><Search size={19} className="text-muted" /><input aria-label={c.searchLabel} placeholder={c.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} /></label>}
          <div className="mt-4 space-y-4">
            {tab === "orders" ? orders.length ? orders.map((order) => {
              const done = order.status === "delivered" || order.status === "collected";
              const active = !finished(order.status);
              const allowed = brand?.services[order.serviceMode] ?? false;
              return <article key={order.id} className="guest-card">
                <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => select(order.id)}>
                  <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${done ? "bg-brand-soft text-brand" : "bg-paper text-muted"}`}>{done ? <Check size={24} /> : order.serviceMode === "pickup" ? <ShoppingBag size={23} /> : <Truck size={23} />}</span>
                  <span className="min-w-0 flex-1"><b className="block text-sm">{statusLabel(order.status, order.serviceMode === "pickup", hindi)}</b><span className="mt-1 block text-xs text-muted">{money(order.totalPaise)} · {new Date(order.at).toLocaleDateString(locale, { day: "numeric", month: "short" })} · {order.serviceMode === "pickup" ? c.pickup : c.delivery}</span></span>
                  <ChevronRight size={17} className="text-muted" />
                </button>
                <button className="flex w-full items-center gap-2 border-t border-line p-4 text-left" aria-label={c.viewItems} onClick={() => select(order.id)}>
                  {order.items.slice(0, 4).map((item, index) => item.imageUrl ? <Image className="guest-thumbnail" key={index} src={item.imageUrl} alt={item.name} width={58} height={58} unoptimized /> : <span key={index} className="guest-thumbnail grid place-items-center"><Package size={20} className="text-muted" /></span>)}
                  {order.items.length > 4 && <span className="px-2 text-sm font-bold">+{order.items.length - 4}</span>}
                  {!order.items.length && <span className="text-sm text-muted">{order.lines.reduce((count, line) => count + line.qty, 0)} {c.items} · {c.viewDetails}</span>}
                </button>
                <div className="flex divide-x divide-line border-t border-line text-sm font-bold text-brand">
                  <button className="min-h-12 flex-1" onClick={() => select(order.id)}>{active ? c.track : c.orderDetails}</button>
                  {!active && allowed && <Link href={`${base}/delivery?new=1&mode=${order.serviceMode}&reorder=${encodeURIComponent(order.id)}`} className="flex min-h-12 flex-1 items-center justify-center">{c.orderAgain}</Link>}
                </div>
              </article>;
            }) : <section className="guest-card p-8 text-center"><Package className="mx-auto mb-3 size-10 text-muted" /><h2 className="font-bold">{search ? c.noMatch : c.firstOrder}</h2><p className="mt-2 text-sm text-muted">{search ? c.trySearch : c.afterOrder}</p>{!search && <Link href={base} className="mt-4 inline-block font-bold text-brand">{c.explore}</Link>}</section>
              : data.bookings.length ? data.bookings.map((booking) => <article key={booking.id} className="guest-card p-5"><h2 className="flex items-center gap-2 font-bold"><CalendarDays size={19} />{booking.kind === "party" ? c.party : c.reservation}</h2><p className="mt-3 text-sm">{new Date(booking.startAt).toLocaleString(locale)}</p><p className="mt-2 text-xs text-muted">{booking.partySize} {c.guests} · {c[booking.status as keyof typeof c] ?? booking.status} · {booking.reference}</p></article>)
                : <p className="guest-card p-6 text-sm text-muted">{c.noBookings}</p>}
          </div>
        </>}
      </>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-line bg-surface p-3 text-sm text-red-500">{error}</p>}
    </main>
  );
}
