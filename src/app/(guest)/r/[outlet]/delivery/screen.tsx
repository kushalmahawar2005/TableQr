"use client";
import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Copy, Headphones, MapPin, ShoppingBag, Truck } from "lucide-react";
import { GuestSheet, LanguageSwitch } from "../_components/guest-ui";
import { BagArt, ClocheArt, ReceiptArt, RouteArt } from "../_components/order-art";
import { useGuestExperience } from "../guest-shell";
import { customerAccountAction, saveCustomerAddressAction } from "../profile/actions";
import type { customerHistory } from "@/server/guest/customer-account";
import { ArrowLeft01Icon, Cancel01Icon, FilterHorizontalIcon, Location01Icon, MinusSignIcon, PlusSignIcon, Search01Icon, ShoppingBasket01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { useGuestBase } from "@/lib/guest-base";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { applyFilters, hasActiveFilters, NO_FILTERS, type MenuFilters } from "@/domain/menu-filter";
import type { DeliveryAddress, DeliveryCartLine } from "@/db/schema/delivery";
import type { OrderServiceMode } from "@/domain/delivery";
import type { deliveryMenu, priceDeliveryCart } from "@/server/delivery/catalog";
import type { deliveryStatus } from "@/server/delivery/checkout";
import { priceLine } from "@/domain/pricing";
import { openCheckout } from "@/lib/payments/checkout";
import { OutletLogo } from "../t/[table]/_components/outlet-logo";
import { LiveMap } from "@/components/live-map";
import { InstallApp } from "@/components/install-app";
import { distanceKm, etaMinutes } from "@/domain/delivery";
import { g3Copy } from "../t/[table]/menu/_copy";
import { CategoryBar } from "../t/[table]/menu/_components/category-bar";
import { FilterBar } from "../t/[table]/menu/_components/filter-bar";
import { Thumb, VegMark } from "../t/[table]/menu/_components/menu-row";
import { connectRealtime } from "@/lib/realtime-client";
import { enableGuestPush, guestPushSupported } from "@/lib/guest-push-client";
import { claimManualQrDeliveryAction, deliveryPushAction, deliveryStatusAction, deliveryTokenAction, pushKeyAction, pincodeAction, placeAction, placeDeliveryAction, rateRiderAction, quoteDeliveryAction, resendDeliveryAction, startDeliveryAction, startDeliveryPaymentAction, verifyDeliveryAction } from "./actions";

type Menu = Awaited<ReturnType<typeof deliveryMenu>>;
type Quote = Awaited<ReturnType<typeof priceDeliveryCart>>;
type Status = Awaited<ReturnType<typeof deliveryStatus>>;
type PinInfo = Awaited<ReturnType<typeof pincodeAction>>;

// Name, phone and address kept on this phone only, so a returning guest does not type them again
const PROFILE_KEY = "tq_delivery_profile";
type Profile = { name: string; phone: string; address: DeliveryAddress };
function readProfile(outlet:string): Profile | null {
  try { const raw = localStorage.getItem(`${PROFILE_KEY}_${outlet}`); return raw ? JSON.parse(raw) as Profile : null; } catch { return null; }
}
function writeProfile(profile: Profile | null, outlet:string) {
  try { if (profile) localStorage.setItem(`${PROFILE_KEY}_${outlet}`, JSON.stringify(profile)); else localStorage.removeItem(`${PROFILE_KEY}_${outlet}`); } catch { /* Private mode: the form still works */ }
}
const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const control = "min-h-12 w-full rounded-2xl border border-line/70 bg-surface px-4 text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]";
const button = "min-h-13 w-full rounded-2xl bg-brand px-4 font-bold text-brand-on disabled:opacity-50";

export function DeliveryScreen({ outletCode, data, initialStatus, initialServiceMode = "delivery", realtimeUrl = null, installable = null, initialCart = [], initialNotice }: { initialNotice?: string; initialCart?: DeliveryCartLine[]; outletCode: string; data?: Menu; initialStatus?: Status; initialServiceMode?: OrderServiceMode; hindi?: boolean; realtimeUrl?: string | null; installable?: { name: string; logoUrl: string | null } | null }) {
  const base = useGuestBase(outletCode);
  const experience = useGuestExperience();
  const hindi = experience.language === "hi";
  const setHindi = (value: boolean) => experience.setLanguage(value ? "hi" : "en");
  const [activeMode, setActiveMode] = useState(initialServiceMode);
  const [addressSheet, setAddressSheet] = useState(false);
  const t = (en: string, hi: string) => hindi ? hi : en;
  const [account,setAccount]=useState<Awaited<ReturnType<typeof customerHistory>>|null>(null);

  const [cart, setCart] = useState<DeliveryCartLine[]>(initialCart);
  const [step, setStep] = useState<"menu" | "address" | "otp" | "review">("menu");
  const [address, setAddress] = useState<DeliveryAddress>({ line: "", locality: "", pincode: "", instructions: "" });
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [otpCode, setOtpCode] = useState("");
  useEffect(()=>{let active=true;void customerAccountAction(outletCode).then(r=>{if(!active||!r.ok)return;setAccount(r.data);setName(r.data.guest.name??"");setPhone(r.data.guest.phone);if(r.data.addresses[0])setAddress(r.data.addresses[0]);});return()=>{active=false}},[outletCode]);
  const [manualReference, setManualReference] = useState("");
  const [otp, setOtp] = useState<{ challengeId: string; devCode?: string; resendIn: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null), [status, setStatus] = useState<Status | undefined>(initialStatus);
  const serviceMode = status?.serviceMode ?? activeMode;
  const [pickupPaymentMode, setPickupPaymentMode] = useState<"cod" | "gateway" | "manual_qr">("cod");
  const [error, setError] = useState<string | null>(null), [pending, start] = useTransition();
  const [selected, setSelected] = useState<Menu["items"][number] | null>(null), [choices, setChoices] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MenuFilters>(NO_FILTERS);
  const allFiltersRef = useRef<HTMLDialogElement>(null);
  const [pin, setPin] = useState<{ code: string; info: PinInfo; busy: boolean } | null>(null);
  const [remember, setRemember] = useState(true);
  const statusCode = status?.status;
  // Live updates for this order; with no live connection the page checks every 10 s instead
  const finished = !statusCode || ["delivered", "collected", "cancelled"].includes(statusCode);
  useEffect(() => {
    if (finished) return;
    let busy = false, timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => { if (busy) return; busy = true; try { const response = await deliveryStatusAction(outletCode); if (response.ok) setStatus(response.data); } finally { busy = false; } };
    const later = () => { if (!timer) timer = setTimeout(() => { timer = null; void refresh(); }, 600); };
    const stop = connectRealtime({
      url: realtimeUrl,
      getToken: async () => { const r = await deliveryTokenAction(outletCode); return r.ok ? r.data : null; },
      pollMs: 10_000,
      onResync: () => { if (!document.hidden) void refresh(); },
      onEvents: (events) => {
        let other = false;
        for (const e of events) {
          // The rider's bike moves on the map straight from the event, no reload
          if (e.type === "rider.location" && e.data) {
            const d = e.data as { lat: number; lng: number; at: number };
            setStatus((current) => (current && current.status === "dispatched" ? { ...current, riderLocation: { lat: d.lat, lng: d.lng, at: d.at } } : current));
          } else other = true;
        }
        if (other) later();
      },
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [outletCode, finished, realtimeUrl]);
  // The browser may close after order placement; the server cookie restores tracking on refresh.
  async function loadStatus() { const response = await deliveryStatusAction(outletCode); if (response.ok) setStatus(response.data); else setError(response.message); }
  async function payDelivery() {
    const response = await startDeliveryPaymentAction(outletCode);
    if (!response.ok) { setError(response.message); return; }
    try { await openCheckout(response.data.checkout); }
    catch { setError(t("The secure payment page could not open. Your order has not been placed. Try again.", "सुरक्षित पेमेंट पेज नहीं खुला। आपका ऑर्डर नहीं हुआ है। फिर कोशिश करें।")); }
  }
  function run(fn: () => Promise<void>) { setError(null); start(async () => { try { await fn(); } catch { setError(t("Connection lost. Please try again.", "कनेक्शन टूट गया। दोबारा कोशिश करें।")); } }); }
  function add(item: Menu["items"][number], modifierIds: string[]) {
    const result = priceLine(item.pricing, 1, modifierIds);
    if (!result.ok) { setError(t("Choose the required options for this dish.", "इस डिश के ज़रूरी विकल्प चुनें।")); return; }
    const key = [...modifierIds].sort().join(",");
    setCart(current => { const exists = current.find(line => line.itemId === item.id && [...line.modifierIds].sort().join(",") === key); return exists ? current.map(line => line === exists ? { ...line, qty: Math.min(20, line.qty + 1) } : line) : [...current, { itemId: item.id, qty: 1, modifierIds }]; });
    setSelected(null);
  }
  /** To the address step, with what this phone remembers filled into anything still empty */
  function openCart() {
    const saved = readProfile(outletCode);
    if (saved) {
      setName(current => current || saved.name || "");
      setPhone(current => current || saved.phone || "");
      setAddress(current => ({
        line: current.line || saved.address?.line || "",
        locality: current.locality || saved.address?.locality || "",
        pincode: current.pincode || saved.address?.pincode || "",
        instructions: current.instructions || saved.address?.instructions || "",
      }));
    }
    if (serviceMode === "pickup" && data?.outlet.policy) {
      const policy = data.outlet.policy;
      setPickupPaymentMode(policy.pickupCodEnabled ? "cod" : data.outlet.gatewayAvailable ? "gateway" : data.outlet.paymentQrUrl ? "manual_qr" : "cod");
    }
    setStep("address");
    // Already on the details page: bring the order summary into view so the tap visibly does something
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  /** Six digits fill the city and offer the areas in that pincode */
  function changePincode(value: string) {
    const code = value.replace(/\D/g, "").slice(0, 6);
    setAddress(current => ({ ...current, pincode: code }));
    if (code.length !== 6) { setPin(null); return; }
    setPin({ code, info: null, busy: true });
    void pincodeAction(code).then(info => {
      setPin(current => current?.code === code ? { code, info, busy: false } : current);
      if (info) setAddress(current => current.pincode === code && !current.locality ? { ...current, locality: info.city } : current);
    }, () => setPin(current => current?.code === code ? { code, info: null, busy: false } : current));
  }
  const policy = data?.outlet.policy;
  // The restaurant's own list of pincodes it delivers to; the server checks it again on order
  const pinComplete = address.pincode.length === 6;
  const outsideArea = !!policy && pinComplete && !policy.pincodes.includes(address.pincode);
  const totalQty = cart.reduce((sum, line) => sum + line.qty, 0);
  // Food only, before tax and delivery; the review step shows the full bill
  const cartPaise = cart.reduce((sum, line) => {
    const item = data?.items.find(i => i.id === line.itemId);
    const priced = item ? priceLine(item.pricing, line.qty, line.modifierIds) : null;
    return sum + (priced?.ok ? priced.line.linePaise : 0);
  }, 0);
  const belowMinimum = !!policy && cartPaise < policy.minimumOrderPaise;
  // Older/stale menu payloads can omit one of these collections. Keep the guest
  // page usable instead of crashing during render while the menu is refreshed.
  const menuItems = Array.isArray(data?.items) ? data.items : [];
  const menuCategories = Array.isArray(data?.categories) ? data.categories : [];
  const filtered = applyFilters(menuItems, filters);
  const filtersOn = hasActiveFilters(filters);
  const visibleItems = filtered.shown.filter(item => `${item.name} ${item.nameHi ?? ""} ${item.description ?? ""} ${item.descriptionHi ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const visibleIds = new Set(visibleItems.map(item => item.id));
  const visibleCategories = menuCategories.map(category => ({
    id: category.id,
    label: hindi ? category.nameHi || category.nameEn : category.nameEn,
    photo: category.imageUrl ?? category.items?.find(item => item.imageUrl)?.imageUrl ?? null,
    items: (Array.isArray(category.items) ? category.items : []).filter(item => visibleIds.has(item.id)),
  })).filter(category => category.items.length > 0) ?? [];
  function itemQty(itemId: string) { return cart.filter(line => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0); }
  function removeOne(itemId: string) {
    setCart(current => {
      const index = current.findIndex(line => line.itemId === itemId);
      if (index < 0) return current;
      return current.map((line, i) => i === index ? { ...line, qty: line.qty - 1 } : line).filter(line => line.qty > 0);
    });
  }
  const statusMessage = !status ? "" : status.status === "draft" && status.paymentStatus === "pending" && status.paymentMode === "manual_qr" ? t("Payment reference submitted · waiting for payment verification", "पेमेंट रेफरेंस भेज दिया · पुष्टि का इंतज़ार") : status.status === "draft" && status.paymentStatus === "pending" ? t("Checking your payment securely…", "आपका पेमेंट सुरक्षित रूप से जाँचा जा रहा है…") : status.status === "draft" && status.paymentStatus.startsWith("refund") ? t("Payment received · refund in progress", "पेमेंट मिला · रिफंड चल रहा है") : status.status === "draft" && status.paymentStatus === "failed" ? t("Payment was not completed. No order was placed.", "पेमेंट पूरा नहीं हुआ। ऑर्डर नहीं हुआ।") : status.status === "placed" && serviceMode === "pickup" ? t(status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "Ready for pickup · collect at the counter" : "Your pickup order is being prepared", status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "पिकअप के लिए तैयार · काउंटर से लें" : "आपका पिकअप ऑर्डर तैयार हो रहा है") : status.status === "placed" ? t(status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "Packed · awaiting dispatch" : "Your order is being prepared", status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "पैक हो गया · भेजने की तैयारी" : "आपका ऑर्डर तैयार हो रहा है") : status.status === "dispatched" ? t("Your order is on the way", "आपका ऑर्डर रास्ते में है") : status.status === "collected" ? t("Pickup complete · thank you", "पिकअप पूरा हुआ · धन्यवाद") : status.status === "delivered" ? t("Delivered", "डिलीवर हो गया") : status.status === "cancelled" ? t("Cancelled", "रद्द किया गया") : t("Complete payment to continue", "जारी रखने के लिए पेमेंट पूरा करें");
  const orderModes = ([{key:"delivery",label:t("Delivery","डिलीवरी"),icon:Truck},{key:"pickup",label:t("Pickup","पिकअप"),icon:ShoppingBag}] as const).filter(mode=>experience.brand?.services[mode.key] ?? mode.key===serviceMode);
  return <main lang={hindi ? "hi" : "en"} className="flex w-full min-w-0 flex-col pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] text-ink">
    {!status && <header className="flex items-center gap-2.5">
      {data ? <Link href={`${base}`} aria-label={t("Back to guest link", "मुख्य पेज पर वापस")} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-brand">
        <OutletLogo name={experience.brand?.outlet.name ?? data.outlet.name} logoUrl={experience.brand?.outlet.logoUrl ?? data.outlet.logoUrl} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-display text-section leading-tight font-bold">{experience.brand?.outlet.name ?? data.outlet.name}</span>
          <span className="block text-caption text-muted">{serviceMode === "pickup" ? t("Pickup / takeaway", "पिकअप / टेकअवे") : t("Home delivery", "घर पर डिलीवरी")} · {data.outlet.policy.estimatedMinutes} {t("min", "मिनट")}</span>
        </span>
      </Link> : <Link href={`${base}`} className="flex-1 text-caption font-semibold text-muted">← {t("Guest link", "मुख्य पेज")}</Link>}
      <LanguageSwitch />
      {!status && <button type="button" disabled={!cart.length} onClick={openCart} aria-label={t(`Your cart, ${totalQty} items`, `आपका कार्ट, ${totalQty} आइटम`)} className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line/70 bg-surface text-ink shadow-[0_2px_8px_rgb(31_41_55/0.06)] hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default">
        <HugeiconsIcon icon={ShoppingBasket01Icon} size={21} aria-hidden />
        {totalQty > 0 && <span aria-hidden className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-label font-bold tabular text-brand-on ring-2 ring-paper">{totalQty}</span>}
      </button>}
    </header>}
    {initialNotice && <p role="status" className="mt-4 rounded-2xl bg-brand-soft p-4 text-xs text-brand-strong">{initialNotice}</p>}
    {error && <p role="alert" className="mt-4 rounded-2xl border border-danger/20 bg-[var(--state-seated-soft)] p-4 text-caption font-semibold text-danger">{error}</p>}
    {status ? <><StatusView outletCode={outletCode} status={status} hindi={hindi} pending={pending} statusMessage={statusMessage} onPay={() => run(payDelivery)} onRefresh={() => run(loadStatus)} newOrderHref={`${base}/delivery?new=1&lang=${hindi ? "hi" : "en"}`} />{installable && <InstallApp guest className="mt-4" name={installable.name} logoUrl={installable.logoUrl} title={t("Install our app", "हमारा ऐप इंस्टॉल करें")} blurb={t(`Track this order and order again from ${installable.name} in one tap.`, `इस ऑर्डर को ट्रैक करें और ${installable.name} से एक टैप में दोबारा ऑर्डर करें।`)} />}</> : <>
    {step === "menu" && data && <>
      {orderModes.length > 1 && <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-ink/5 p-1" aria-label="Order type">
        {orderModes.map(({key,label,icon:Icon})=><button key={key} type="button" aria-pressed={serviceMode===key} onClick={()=>setActiveMode(key)} className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-bold ${serviceMode===key?"bg-surface text-brand":"text-muted"}`}><Icon size={17}/>{label}</button>)}
      </div>}
      {experience.brand?.services.reservations&&<Link href={`${base}/book`} className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"><CalendarDays size={20} className="text-brand"/><span className="flex-1 text-sm"><b className="block">{t("A table for your next get-together?","अगली मुलाकात के लिए टेबल?")}</b><span className="text-xs text-muted">{t("Reserve a table or plan a party","टेबल या पार्टी बुक करें")}</span></span><ChevronRight size={18}/></Link>}

      <div className="mt-5">
        <h1 className="font-display text-[1.625rem] leading-tight font-bold tracking-tight">{t("What are you craving?", "आज क्या खाने का मन है?")}</h1>
        <p className="mt-1 text-body text-muted">{serviceMode === "pickup" ? t("Order ahead and collect it at the counter. Choose an available payment method at checkout.", "पहले ऑर्डर करें और काउंटर से लें। चेकआउट पर उपलब्ध पेमेंट तरीका चुनें।") : t(`Freshly prepared, delivered in about ${data.outlet.policy.estimatedMinutes} minutes. ${data.outlet.policy.paymentMode === "gateway" ? "Pay securely before preparation." : data.outlet.policy.paymentMode === "manual_qr" ? "Pay using the business QR." : "Pay when your order arrives."}`, `ताज़ा तैयार, लगभग ${data.outlet.policy.estimatedMinutes} मिनट में डिलीवरी। ${data.outlet.policy.paymentMode === "gateway" ? "तैयारी से पहले सुरक्षित पेमेंट करें।" : data.outlet.policy.paymentMode === "manual_qr" ? "बिज़नेस QR से पेमेंट करें।" : "ऑर्डर मिलने पर भुगतान करें।"}`)}</p>
      </div>
      <form role="search" onSubmit={event => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }} className="mt-4">
        <label className="relative block">
          <span className="sr-only">{t("Search menu", "मेन्यू में खोजें")}</span>
          <HugeiconsIcon icon={Search01Icon} size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand" aria-hidden />
          <input type="search" enterKeyHint="search" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Search paneer, dosa, coffee…", "पनीर, डोसा, कॉफ़ी खोजें…")} className="h-[52px] w-full rounded-2xl border border-line/70 bg-surface pr-12 pl-12 text-body text-ink shadow-[0_2px_10px_rgb(31_41_55/0.05)] outline-none placeholder:text-muted/80 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] [&::-webkit-search-cancel-button]:hidden" />
          {search ? <button type="button" onClick={() => setSearch("")} aria-label={t("Clear search", "खोज साफ़ करें")} className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"><HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden /></button>
            : <button type="button" onClick={() => allFiltersRef.current?.showModal()} aria-haspopup="dialog" aria-label={filtersOn ? t("Filters. Filters on", "फ़िल्टर। फ़िल्टर चालू हैं") : t("Filters", "फ़िल्टर")} className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-xl border-l border-line/70 text-ink/70 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
                <HugeiconsIcon icon={FilterHorizontalIcon} size={20} aria-hidden />
                {filtersOn && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-brand ring-2 ring-surface" />}
              </button>}
        </label>
      </form>
      <div className="mt-3">
        <FilterBar filters={filters} onChange={setFilters} lang={hindi ? "hi" : "en"} c={g3Copy[hindi ? "hi" : "en"]} allRef={allFiltersRef} />
      </div>
      {filtersOn && <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-caption text-muted">
        {filtered.hidden > 0 && <span>{g3Copy[hindi ? "hi" : "en"].hidden(filtered.hidden)}</span>}
        {filtered.hidden > 0 && <span aria-hidden>·</span>}
        <button type="button" onClick={() => setFilters(NO_FILTERS)} className="-my-2 py-2 font-semibold text-brand-strong hover:underline">{g3Copy[hindi ? "hi" : "en"].clearFilters}</button>
      </p>}
      {visibleCategories.length > 0 && <CategoryBar categories={visibleCategories.map(({ id, label, photo }) => ({ id, label, photo }))} label={t("Menu categories", "मेन्यू कैटेगरी")} />}
      {visibleCategories.map(category => <section key={category.id} id={`cat-${category.id}`} aria-labelledby={`dh-${category.id}`} className="scroll-mt-32 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={`dh-${category.id}`} className="font-display text-title font-bold">{category.label}</h2>
          <span className="shrink-0 rounded-full border border-line/80 bg-surface px-2.5 py-0.5 text-caption text-muted">{t(`${category.items.length} ${category.items.length === 1 ? "item" : "items"}`, `${category.items.length} आइटम`)}</span>
        </div>
        <ul className="mt-3">
          {category.items.map(item => {
            const qty = itemQty(item.id);
            const available = item.available;
            const itemName = hindi ? item.nameHi || item.name : item.name;
            const description = hindi ? item.descriptionHi || item.description : item.description;
            const customise = item.pricing.groups.length > 0;
            const addOne = () => { if (customise) { setSelected(item); setChoices([]); } else add(item, []); };
            return <li key={item.id} className="relative mb-3 flex gap-3.5 rounded-[20px] border border-line/60 bg-surface p-3 shadow-[0_2px_12px_rgb(31_41_55/0.05)]">
              <Thumb photo={item.imageUrl} soldOut={!available} size="size-[104px] min-[380px]:size-[112px]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted">
                  <VegMark veg={item.isVeg} label={item.isVeg ? t("Vegetarian", "शाकाहारी") : t("Non-vegetarian", "मांसाहारी")} />
                  <span aria-hidden className="font-medium">{item.isVeg ? t("Veg", "शाकाहारी") : t("Non-veg", "मांसाहारी")}</span>
                  {item.isJain && <span className="rounded-[4px] border border-line px-1 text-[10px] leading-3.5 font-semibold">{t("Jain", "जैन")}</span>}
                </div>
                <h3 className="mt-1 font-display text-[1.0625rem] leading-snug font-bold">{itemName}</h3>
                {description && <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-muted">{description}</p>}
                {customise && <p className="mt-0.5 text-label font-semibold text-brand-strong">{t("Customisable", "विकल्प उपलब्ध")}</p>}
                <p className={`mt-auto flex min-h-10 items-end pt-1.5 pr-[116px] font-display text-section font-bold tabular ${available ? "text-ink" : "text-muted"}`}>{money(item.pricing.pricePaise)}</p>
              </div>
              <div className="absolute right-3 bottom-3">
                {!available ? <span className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink/70">{t("Sold out", "खत्म")}</span>
                  : !qty ? <button type="button" onClick={addOne} aria-label={t(`Add ${itemName}`, `${itemName} जोड़ें`)} className="relative flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-body font-bold text-brand-on transition-[transform,background-color] duration-100 before:absolute before:-inset-1 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.96]"><HugeiconsIcon icon={PlusSignIcon} size={17} strokeWidth={2.6} aria-hidden />{t("Add", "जोड़ें")}</button>
                  : <div role="group" aria-label={t(`${qty} × ${itemName}`, `${qty} × ${itemName}`)} className="flex h-10 min-w-[96px] items-center justify-between gap-1 rounded-xl bg-brand text-brand-on">
                    <button type="button" aria-label={t(`Remove ${itemName}`, `${itemName} हटाएँ`)} onClick={() => removeOne(item.id)} className="grid h-full w-9 place-items-center active:scale-90"><HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2.4} aria-hidden /></button>
                    <span aria-live="polite" className="min-w-6 text-center text-body font-bold tabular">{qty}</span>
                    <button type="button" aria-label={t(`Add ${itemName}`, `${itemName} जोड़ें`)} onClick={addOne} className="grid h-full w-9 place-items-center active:scale-90"><HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2.4} aria-hidden /></button>
                  </div>}
              </div>
            </li>;
          })}
        </ul>
      </section>)}
      {visibleCategories.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center text-caption text-muted">{menuItems.length > 0 ? (filtersOn ? t("No dishes match your filters.", "आपके फ़िल्टर से कोई डिश नहीं मिली।") : t("No dishes match your search.", "आपकी खोज से कोई डिश नहीं मिली।")) : serviceMode === "pickup" ? t("No pickup dishes are available right now.", "अभी पिकअप के लिए कोई डिश उपलब्ध नहीं है।") : t("No delivery dishes are available right now.", "अभी डिलीवरी के लिए कोई डिश उपलब्ध नहीं है।")}</p>}
      {cart.length > 0 && <div className="fixed inset-x-0 bottom-[var(--guest-nav-height,0px)] z-30 mx-auto max-w-[480px] px-4 pb-[max(12px,env(safe-area-inset-bottom))] min-[360px]:px-5">
        <button type="button" onClick={openCart} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-brand px-4 py-2.5 text-left text-brand-on transition-transform active:scale-[0.99]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20"><HugeiconsIcon icon={ShoppingBasket01Icon} size={19} aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block text-label opacity-85">{t(`${totalQty} ${totalQty === 1 ? "item" : "items"}`, `${totalQty} आइटम`)}</span><span className="block text-body font-bold tabular">{money(cartPaise)} <span className="text-label font-medium opacity-80">{t("+ taxes", "+ टैक्स")}</span></span></span>
          <span className="text-body font-bold">{t("View cart", "कार्ट देखें")} →</span>
        </button>
      </div>}
    </>}
    {selected && <GuestSheet title={selected.name} onClose={()=>setSelected(null)}><div className="space-y-4">{selected.pricing.groups.map(group => <fieldset key={group.id} className="space-y-2"><legend className="font-semibold">{group.nameEn} · {group.minSelect > 0 ? t("Required", "ज़रूरी") : t("Optional", "वैकल्पिक")}</legend>{group.modifiers.map(option => <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={choices.includes(option.id)} onChange={event => setChoices(current => event.target.checked ? group.maxSelect === 1 ? [...current.filter(id => !group.modifiers.some(modifier => modifier.id === id)), option.id] : [...current, option.id] : current.filter(id => id !== option.id))} />{option.nameEn} {option.priceDeltaPaise ? `+ ${money(option.priceDeltaPaise)}` : ""}</label>)}</fieldset>)}<button type="button" className={button} onClick={() => add(selected, choices)}>{t("Add to cart", "कार्ट में जोड़ें")}</button></div></GuestSheet>}
    {step === "address" && serviceMode === "delivery" && <section className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"><MapPin size={21} className="shrink-0 text-brand"/><div className="min-w-0 flex-1"><p className="text-sm font-bold">{t("Delivering to","डिलीवरी का पता")}</p><p className="truncate text-xs text-muted">{address.line ? `${address.line}, ${address.locality}` : t("Choose or add a delivery address","डिलीवरी का पता चुनें")}</p></div><button type="button" className="min-h-11 px-2 text-sm font-bold text-brand" onClick={()=>setAddressSheet(true)}>{t("Change","बदलें")}</button></section>}
    {addressSheet&&<GuestSheet title={t("Select delivery location","डिलीवरी का पता चुनें")} onClose={()=>setAddressSheet(false)}><button type="button" className="mb-4 flex min-h-12 w-full items-center gap-2 rounded-xl bg-brand-soft p-3 text-sm font-bold text-brand-strong" onClick={()=>{setAddress({line:"",locality:"",pincode:"",instructions:""});setPin(null);setAddressSheet(false);document.getElementById("delivery-address")?.scrollIntoView({behavior:"smooth",block:"start"})}}>+ {t("Add a new address","नया पता जोड़ें")}</button>{account?<><p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{t("Your saved addresses","आपके सेव किए पते")}</p><div className="space-y-3">{account.addresses.map(a=><button type="button" key={a.id} onClick={()=>{setAddress(a);setAddressSheet(false)}} className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left ${address.line===a.line&&address.pincode===a.pincode?"border-brand bg-brand-soft":"border-line bg-paper"}`}><MapPin size={20} className="shrink-0"/><span><b className="block text-sm">{a.label}</b><span className="mt-1 block text-xs text-muted">{a.line}, {a.locality} · {a.pincode}</span></span></button>)}{!account.addresses.length&&<p className="text-sm text-muted">{t("No saved addresses yet. Add your first address below.","अभी कोई सेव किया पता नहीं है।")}</p>}</div></>:<Link href={`${base}/profile`} className="text-sm font-semibold underline">{t("Sign in to use saved addresses","सेव किए पते के लिए साइन इन करें")}</Link>}</GuestSheet>}

    {step !== "menu" && <div className="mt-5 space-y-4"><button type="button" disabled={pending} onClick={() => { setStep("menu"); setQuote(null); }} className="relative -ml-1 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-caption font-semibold text-muted before:absolute before:-inset-2.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"><HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} aria-hidden />{t("Back to menu", "मेन्यू पर वापस")}</button><h1 className="font-display text-[1.625rem] leading-tight font-bold tracking-tight">{t(step === "otp" ? "Verify your phone" : step === "review" ? "Review and place order" : serviceMode === "pickup" ? "Pickup details" : "Delivery details", step === "otp" ? "फ़ोन सत्यापित करें" : step === "review" ? "ऑर्डर की पुष्टि करें" : serviceMode === "pickup" ? "पिकअप की जानकारी" : "डिलीवरी की जानकारी")}</h1>
      {step === "address" && <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { const response = await startDeliveryAction(outletCode, cart, address, phone, serviceMode, serviceMode === "pickup" ? pickupPaymentMode : undefined, name); if (!response.ok) { setError(response.message); return; } writeProfile(remember ? { name, phone, address } : null,outletCode); setQuote(response.data.quote); if(response.data.otp){setOtp(response.data.otp);setResendAt(Date.now()+response.data.otp.resendIn*1000);setStep("otp");}else{if(serviceMode === "delivery" && remember&&account&&!account.addresses.some(a=>a.line===address.line&&a.pincode===address.pincode))await saveCustomerAddressAction(outletCode,address,"Home");setStep("review");} }); }}>
        <FormCard icon={ShoppingBasket01Icon} title={t("Your order", "आपका ऑर्डर")} aside={<span className="text-body font-bold tabular">{money(cartPaise)}</span>}>
          <ul className="mt-2 divide-y divide-line/70">
            {cart.map((line, index) => <li key={index} className="flex items-center gap-3 py-3">
              <Thumb photo={data?.items.find(item=>item.id===line.itemId)?.imageUrl ?? null} size="size-14"/>

              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{(hindi && data?.items.find(item => item.id === line.itemId)?.nameHi) || data?.items.find(item => item.id === line.itemId)?.name}</p><p className="mt-1 text-xs text-muted">{data?.items.find(item=>item.id===line.itemId)?.pricing.groups.flatMap(group=>group.modifiers).filter(option=>line.modifierIds.includes(option.id)).map(option=>(hindi&&option.nameHi)||option.nameEn).join(" · ")}</p></div>
              <div className="flex h-9 items-center gap-1 rounded-xl border border-line/70 bg-paper">
                <button type="button" aria-label={t("Remove one", "एक हटाएँ")} className="grid h-full w-9 place-items-center text-ink" onClick={() => setCart(current => current.map((value, i) => i === index ? { ...value, qty: value.qty - 1 } : value).filter(value => value.qty > 0))}><HugeiconsIcon icon={MinusSignIcon} size={15} strokeWidth={2.4} aria-hidden /></button>
                <span className="min-w-5 text-center text-body font-bold tabular">{line.qty}</span>
                <button type="button" aria-label={t("Add one", "एक और")} className="grid h-full w-9 place-items-center text-ink" onClick={() => setCart(current => current.map((value, i) => i === index ? { ...value, qty: Math.min(20, value.qty + 1) } : value))}><HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2.4} aria-hidden /></button>
              </div>
            </li>)}
          </ul>
          {policy && serviceMode === "delivery" && <OrderGoals hindi={hindi} cartPaise={cartPaise} minimumPaise={policy.minimumOrderPaise} freeAbovePaise={policy.freeDeliveryAbovePaise} feePaise={policy.deliveryFeePaise} />}
          <button type="button" disabled={pending} onClick={() => { setStep("menu"); setQuote(null); }} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/50 px-4 text-caption font-bold text-brand-strong hover:bg-brand-soft/40 disabled:opacity-60"><HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} aria-hidden />{t("Add more items", "और आइटम जोड़ें")}</button>
        </FormCard>

        <FormCard icon={UserIcon} title={t("Contact", "संपर्क")}>
          <div className="mt-3 grid gap-3">
            <label className="block text-caption font-semibold text-muted">{t("Name", "नाम")}<input required maxLength={40} autoComplete="name" className={`${control} mt-1.5 bg-paper`} value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="block text-caption font-semibold text-muted">{t("Mobile number", "मोबाइल नंबर")}
              <span className="relative mt-1.5 block"><span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-body font-semibold text-ink">+91</span><input required inputMode="tel" type="tel" autoComplete="tel-national" maxLength={15} className={`${control} bg-paper pl-14`} value={phone} onChange={event => setPhone(event.target.value)} /></span>
            </label>
          </div>
        </FormCard>

        {serviceMode === "delivery" && <div id="delivery-address" className="scroll-mt-6"><FormCard icon={Location01Icon} title={t("Delivery address", "डिलीवरी पता")}>
          <div className="mt-3 grid gap-3">
            <label className="block text-caption font-semibold text-muted">{t("Pincode", "पिनकोड")}
              <input required inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="302017" className={`${control} mt-1.5 bg-paper tracking-[.2em] tabular`} value={address.pincode} onChange={event => changePincode(event.target.value)} />
            </label>
            {outsideArea ? <div role="alert" className="-mt-1 rounded-2xl border border-danger/20 bg-[var(--state-seated-soft)] p-3 text-caption text-danger">
              <p className="font-bold">{t(`Sorry, we don't deliver to ${address.pincode} yet.`, `माफ़ करें, ${address.pincode} पर अभी डिलीवरी नहीं होती।`)}</p>
              {policy!.pincodes.length > 0 && <p className="mt-1 text-ink/80">{t("We deliver to", "हम यहाँ डिलीवर करते हैं")}: <span className="font-semibold tabular">{policy!.pincodes.join(", ")}</span></p>}
            </div> : pin && <p role="status" className="-mt-1 text-caption text-muted">{pin.busy ? t("Finding your area…", "आपका इलाका खोज रहे हैं…") : pin.info ? <span className="inline-flex items-center gap-1 font-semibold text-success"><HugeiconsIcon icon={Location01Icon} size={14} aria-hidden />{pin.info.city}, {pin.info.state} · {t("we deliver here", "यहाँ डिलीवरी होती है")}</span> : t("We could not find this pincode. Please type your area below.", "यह पिनकोड नहीं मिला। कृपया नीचे अपना इलाका लिखें।")}</p>}
            {!outsideArea && pin?.info && pin.info.areas.length > 0 && <div>
              <p className="text-caption font-semibold text-muted">{t("Pick your area", "अपना इलाका चुनें")}</p>
              <div className="mt-2 flex flex-wrap gap-2">{pin.info.areas.map(area => {
                const value = `${area}, ${pin.info!.city}`;
                const on = address.locality === value;
                return <button key={area} type="button" aria-pressed={on} onClick={() => setAddress(current => ({ ...current, locality: value }))} className={`min-h-9 rounded-full border px-3.5 text-caption font-semibold transition-colors ${on ? "border-brand bg-brand text-brand-on" : "border-line/70 bg-surface text-ink hover:border-ink/30"}`}>{area}</button>;
              })}</div>
            </div>}
            <ExactPin hindi={hindi} address={address} onPin={(p) => setAddress(current => ({ ...current, ...p }))} onPlace={(place) => {
              // The server sends a pincode only once India Post confirms it
              const trusted = !!place.pincode;
              if (trusted) changePincode(place.pincode);
              setAddress(current => ({ ...current, locality: place.locality || current.locality, line: place.line || current.line }));
              return trusted || !!address.pincode;
            }} />
            <label className="block text-caption font-semibold text-muted">{t("Area and city", "इलाका और शहर")}<input required maxLength={100} autoComplete="address-level2" className={`${control} mt-1.5 bg-paper`} value={address.locality} onChange={event => setAddress(current => ({ ...current, locality: event.target.value }))} /></label>
            <label className="block text-caption font-semibold text-muted">{t("House / flat, building and street", "घर / फ्लैट, बिल्डिंग और सड़क")}<input required maxLength={200} autoComplete="street-address" className={`${control} mt-1.5 bg-paper`} value={address.line} onChange={event => setAddress(current => ({ ...current, line: event.target.value }))} /></label>
            <label className="block text-caption font-semibold text-muted">{t("Delivery instructions (optional)", "डिलीवरी निर्देश (वैकल्पिक)")}<input maxLength={200} autoComplete="off" placeholder={t("e.g. Ring the bell, near the temple", "जैसे घंटी बजाएँ, मंदिर के पास")} className={`${control} mt-1.5 bg-paper`} value={address.instructions} onChange={event => setAddress(current => ({ ...current, instructions: event.target.value }))} /></label>
          </div>
        </FormCard></div>}

        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 text-caption text-ink"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} className="size-5 accent-[var(--brand-main)]" />{t("Save my details on this phone for next time", "अगली बार के लिए मेरी जानकारी इस फ़ोन में सेव करें")}</label>
        {serviceMode === "pickup" && data && <fieldset className="space-y-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-bold">{t("How would you like to pay?", "पेमेंट कैसे करना चाहेंगे?")}</legend>
          {data.outlet.policy.pickupCodEnabled && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="pickup-payment" checked={pickupPaymentMode === "cod"} onChange={() => setPickupPaymentMode("cod")} />{t("Pay at pickup", "पिकअप पर पेमेंट करें")}</label>}
          {data.outlet.gatewayAvailable && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="pickup-payment" checked={pickupPaymentMode === "gateway"} onChange={() => setPickupPaymentMode("gateway")} />{t("Pay online", "ऑनलाइन पेमेंट करें")}</label>}
          {data.outlet.paymentQrUrl && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="pickup-payment" checked={pickupPaymentMode === "manual_qr"} onChange={() => setPickupPaymentMode("manual_qr")} />{t("Pay with UPI QR", "UPI QR से पेमेंट करें")}</label>}
        </fieldset>}
        <div className="guest-checkout-footer"><p className="mb-2 flex items-center justify-between text-xs text-muted"><span>{t("Food subtotal · final total at review", "खाने का मूल्य · कुल अगले चरण में")}</span><b className="text-sm text-ink">{money(cartPaise)}</b></p><button disabled={pending || !cart.length || (serviceMode === "delivery" && outsideArea) || belowMinimum} className={button}>{pending ? t("Checking…", "जाँच रहे हैं…") : serviceMode === "delivery" && outsideArea ? t("We don't deliver here yet", "यहाँ अभी डिलीवरी नहीं") : t(account ? "Continue to review →" : "Continue · verify phone", "आगे बढ़ें · फ़ोन सत्यापित करें")}</button></div>
      </form>}
      {step === "otp" && otp && <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { const response = await verifyDeliveryAction(outletCode, otp.challengeId, otpCode, name); if (!response.ok) { setError(response.message); return; } setStep("review"); }); }}><p className="text-sm text-muted">{t(`Enter the four-digit code sent to ${phone}.`, `${phone} पर भेजा गया चार अंकों का कोड दर्ज करें।`)}</p>{otp.devCode && <p className="rounded-xl bg-brand-soft p-3 text-sm">{t("Demo code", "डेमो कोड")}: <strong>{otp.devCode}</strong></p>}<input aria-label="Verification code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className={control} value={otpCode} onChange={event => setOtpCode(event.target.value.replace(/\D/g, ""))} /><button disabled={pending} className={button}>{t("Verify phone", "फ़ोन सत्यापित करें")}</button><button type="button" disabled={pending} className={control} onClick={() => run(async () => { if (Date.now() < resendAt) { setError(t("Wait a minute before resending.", "दोबारा भेजने से पहले एक मिनट रुकें।")); return; } const response = await resendDeliveryAction(outletCode, phone); if (!response.ok) { setError(response.message); return; } setOtp(response.data); setOtpCode(""); setResendAt(Date.now() + response.data.resendIn * 1000); })}>{t("Resend code", "कोड दोबारा भेजें")}</button></form>}
      {step === "review" && quote && data && <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
        {quote.lines.map((line, index) => <div key={index} className="flex justify-between gap-3 text-sm"><span>{line.qty} × {line.name}</span><span>{money(line.linePaise)}</span></div>)}
        <div className="space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><span>{t("Food", "खाना")}</span><span>{money(quote.subtotalPaise)}</span></div>
          <div className="flex justify-between"><span>{t("Tax", "टैक्स")}</span><span>{money(quote.taxPaise)}</span></div>
          {serviceMode === "delivery" && <div className="flex justify-between"><span>{t("Delivery", "डिलीवरी")}</span><span>{money(quote.deliveryFeePaise)}</span></div>}
          <div className="flex justify-between text-lg font-bold"><span>{t("Total", "कुल")}</span><span>{money(quote.totalPaise)}</span></div>
        </div>
        <p className="text-sm text-muted">{name} · {phone}{serviceMode === "pickup" ? <><br />{t("Pickup at the counter", "काउंटर से पिकअप")}</> : <><br />{address.line}, {address.locality} · {address.pincode}</>}</p>
        {((serviceMode === "pickup" && pickupPaymentMode === "manual_qr") || (serviceMode === "delivery" && data.outlet.policy.paymentMode === "manual_qr")) && <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">{t("Pay this amount before your order is prepared.", "ऑर्डर तैयार होने से पहले यह रकम पे करें।")} <strong>{money(quote.totalPaise)}</strong></p>
          {data.outlet.paymentQrUrl ? <Image src={data.outlet.paymentQrUrl} alt={t("Business payment QR", "बिज़नेस पेमेंट QR")} width={220} height={220} unoptimized className="mx-auto rounded-lg bg-white p-2" /> : <p role="alert" className="text-sm text-red-700">{t("The payment QR is unavailable. Contact staff.", "पेमेंट QR उपलब्ध नहीं है। स्टाफ से संपर्क करें।")}</p>}
          <label className="block space-y-2 text-sm font-semibold">{t("UPI transaction reference / UTR", "UPI ट्रांज़ैक्शन रेफरेंस / UTR")}<input required minLength={6} maxLength={40} autoComplete="off" className={control} value={manualReference} onChange={event => setManualReference(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="e.g. 612345678901" /></label>
          <p className="text-xs text-muted">{t("The order reaches the kitchen after staff verifies the payment.", "स्टाफ पेमेंट की पुष्टि के बाद ऑर्डर किचन में जाएगा।")}</p>
        </div>}
        <p className="text-sm font-semibold">{serviceMode === "pickup" ? pickupPaymentMode === "cod" ? t("Pay at the counter when you collect your order.", "ऑर्डर लेते समय काउंटर पर पेमेंट करें।") : pickupPaymentMode === "gateway" ? t("Pay securely online before the kitchen prepares your order.", "किचन में ऑर्डर बनने से पहले सुरक्षित ऑनलाइन पेमेंट करें।") : t("Submit your UPI reference after paying; staff will verify it.", "पेमेंट के बाद UPI रेफरेंस भेजें; स्टाफ उसकी पुष्टि करेगा।") : data.outlet.policy.paymentMode === "gateway" ? t("Pay securely before preparation; the order starts after payment confirmation.", "ऑर्डर बनने से पहले सुरक्षित पेमेंट करें; पुष्टि के बाद तैयारी शुरू होगी।") : data.outlet.policy.paymentMode === "manual_qr" ? t("Submit only after your UPI payment is complete.", "UPI पेमेंट पूरा होने के बाद ही रेफरेंस भेजें।") : t("Pay when your order arrives.", "ऑर्डर मिलने पर पेमेंट करें।")}</p>
        <div className="guest-checkout-footer"><p className="mb-2 flex items-center justify-between text-xs text-muted"><span>{t("Total payable", "कुल पेमेंट")}</span><b className="text-lg text-ink">{money(quote.totalPaise)}</b></p><button type="button" disabled={pending || ((serviceMode === "pickup" ? pickupPaymentMode : data.outlet.policy.paymentMode) === "manual_qr" && (manualReference.trim().length < 6 || !data.outlet.paymentQrUrl))} className={button} onClick={() => run(async () => {
          const selectedPayment = serviceMode === "pickup" ? pickupPaymentMode : data.outlet.policy.paymentMode;
          if (selectedPayment === "gateway") { await payDelivery(); return; }
          if (selectedPayment === "manual_qr") {
            const response = await claimManualQrDeliveryAction(outletCode, quote.totalPaise, manualReference);
            if (!response.ok) { setError(response.message); return; }
            await loadStatus(); return;
          }
          const response = await placeDeliveryAction(outletCode, quote.totalPaise);
          if (!response.ok) { setError(response.message); const refreshed = await quoteDeliveryAction(outletCode, cart, serviceMode === "delivery" ? address.pincode : "", serviceMode); if (refreshed.ok) setQuote(refreshed.data); return; }
          await loadStatus();
        })}>{pending ? t("Placing your order…", "ऑर्डर कर रहे हैं…") : serviceMode === "pickup" ? pickupPaymentMode === "gateway" ? t("Pay online · place pickup order", "ऑनलाइन पेमेंट करें · पिकअप ऑर्डर दें") : pickupPaymentMode === "manual_qr" ? t("I’ve paid · send for verification", "पेमेंट हो गया · पुष्टि के लिए भेजें") : t("Place pickup order", "पिकअप ऑर्डर करें") : data.outlet.policy.paymentMode === "gateway" ? t("Pay securely · place order", "सुरक्षित पेमेंट करें · ऑर्डर दें") : data.outlet.policy.paymentMode === "manual_qr" ? t("I’ve paid · send for verification", "पेमेंट हो गया · पुष्टि के लिए भेजें") : t("Place delivery order", "डिलीवरी ऑर्डर करें")}</button></div>
      </section>}
    </div>}
    </>}
  </main>;
}

/** One white card per part of the form, with an icon and a title */
function FormCard({ icon, title, aside, children }: { icon: typeof UserIcon; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-[22px] border border-line/60 bg-surface p-4 shadow-[0_2px_12px_rgb(31_41_55/0.05)]">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-body font-bold"><span aria-hidden className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong"><HugeiconsIcon icon={icon} size={17} /></span>{title}</h2>
      {aside}
    </div>
    {children}
  </section>;
}

/** After ordering: where the food is, who is bringing it, and what is left to pay */
/** A long order id, short enough to read: 01a1930f...f44a */
export const shortOrderId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id);

/** What the guest should read first, from the order's real status and the outlet's promised time */
function orderHeadline(status: Status, stage: number, t: (en: string, hi: string) => string, cashCollected: boolean) {
  const pickup = status.serviceMode === "pickup";
  const away = status.riderLocation && status.address.lat !== undefined && status.address.lng !== undefined ? etaMinutes(distanceKm(status.riderLocation, { lat: status.address.lat, lng: status.address.lng })) : null;
  const eta = status.minutesLeft !== null && status.minutesLeft > 0 ? t(`About ${status.minutesLeft} mins`, `लगभग ${status.minutesLeft} मिनट`) : null;
  const help = t("Need help with this order?", "इस ऑर्डर में मदद चाहिए?");
  if (status.status === "draft") return { art: <ReceiptArt />, kicker: t("Payment pending", "पेमेंट बाकी"), title: pickup ? t("Pickup payment", "पिकअप पेमेंट") : t("Delivery payment", "डिलीवरी पेमेंट"), next: t("We send your order to the kitchen once the payment is confirmed.", "पेमेंट की पुष्टि होते ही ऑर्डर किचन में जाएगा।"), nextTitle: t("What happens next", "आगे क्या होगा"), help };
  if (status.status === "cancelled") {
    const refund = status.refundStatus === "pending" ? t("Refund in progress", "रिफंड जारी है") : status.refundStatus === "success" ? t("Refund returned", "रिफंड लौटाया गया") : status.refundStatus === "failed" ? t("Refund failed", "रिफंड नहीं हुआ") : null;
    return { art: <ReceiptArt cancelled />, kicker: t("Order cancelled", "ऑर्डर रद्द"), title: refund ?? t("No payment due", "कोई पेमेंट बाकी नहीं"), lead: refund ? t("This order was cancelled.", "यह ऑर्डर रद्द हो गया।") : t("This order was cancelled. You have not been charged.", "यह ऑर्डर रद्द हो गया। आपसे कोई पैसा नहीं लिया गया।"), nextTitle: refund ? refund : t("You will not be charged", "आपसे पैसा नहीं लिया जाएगा"), next: t("Contact help if you need to know more.", "ज़्यादा जानकारी के लिए मदद लें।"), help };
  }
  if (status.status === "delivered" || status.status === "collected") return { art: <ClocheArt mark="check" />, kicker: pickup ? t("Order collected", "ऑर्डर ले लिया गया") : t("Delivery complete", "डिलीवरी पूरी हुई"), title: t("Enjoy your meal", "खाने का आनंद लें"), lead: `${pickup ? t("You have collected your order.", "आपने ऑर्डर ले लिया।") : t("Your order has been delivered.", "आपका ऑर्डर पहुँच गया।")}${cashCollected ? ` ${t(`${money(status.totalPaise)} collected in cash.`, `${money(status.totalPaise)} नकद लिया गया।`)}` : ""}`, nextTitle: t("Thank you for ordering", "ऑर्डर करने के लिए धन्यवाद"), next: t("Your receipt is ready below. You can reorder when you like.", "आपकी रसीद नीचे है। जब चाहें फिर से ऑर्डर करें।"), help };
  if (status.status === "dispatched") return { art: null, kicker: t("On the way to you", "आपके पास आ रहा है"), title: away !== null ? t(`Arriving in about ${away} mins`, `लगभग ${away} मिनट में`) : t("Your rider is coming", "राइडर आ रहे हैं"), lead: t("Keep your phone nearby for your rider.", "राइडर के लिए फ़ोन पास रखें।"), nextTitle: t("What happens next", "आगे क्या होगा"), next: status.paid ? t("Meet your rider at the delivery address.", "डिलीवरी पते पर राइडर से मिलें।") : t(`Meet your rider at the delivery address. Keep ${money(status.totalPaise)} ready for cash payment.`, `डिलीवरी पते पर राइडर से मिलें। ${money(status.totalPaise)} नकद तैयार रखें।`), help };
  if (status.minutesLeft !== null && status.minutesLeft <= 0) return { art: <ClocheArt mark="clock" />, kicker: t("Taking a little longer", "थोड़ा ज़्यादा समय लग रहा है"), title: t("ETA unavailable", "समय पता नहीं"), lead: t("Sorry for the wait. Preparation is taking longer.", "इंतज़ार के लिए माफ़ करें। तैयारी में ज़्यादा समय लग रहा है।"), nextTitle: t("What happens next", "आगे क्या होगा"), next: t("We cannot confirm a revised time. Refresh or contact the restaurant for an update.", "नया समय पक्का नहीं है। रिफ्रेश करें या रेस्टोरेंट से पूछें।"), help: t("Let us help with the wait", "इंतज़ार में मदद लें") };
  if (stage >= 2) return { art: <BagArt />, kicker: pickup ? t("Ready for pickup", "पिकअप के लिए तैयार") : t("Packed · Awaiting pickup", "पैक हो गया · राइडर का इंतज़ार"), title: pickup ? t("Come and collect", "आकर ले जाएँ") : eta ?? t("Packed", "पैक हो गया"), lead: pickup ? t("Your order is ready at the counter.", "आपका ऑर्डर काउंटर पर तैयार है।") : t("Packed and waiting for a rider to collect.", "पैक है, राइडर का इंतज़ार है।"), nextTitle: t("What happens next", "आगे क्या होगा"), next: pickup ? t(`Show your name at the counter.${status.paid ? "" : ` Keep ${money(status.totalPaise)} ready.`}`, `काउंटर पर अपना नाम बताएँ।${status.paid ? "" : ` ${money(status.totalPaise)} तैयार रखें।`}`) : t("A rider will collect your meal. It has not left the restaurant yet.", "राइडर आपका खाना लेंगे। अभी रेस्टोरेंट से निकला नहीं है।"), help };
  if (stage === 1) return { art: <ClocheArt mark="steam" />, kicker: t("In the kitchen", "किचन में"), title: eta ? t(`Ready in ${status.minutesLeft} mins`, `${status.minutesLeft} मिनट में तैयार`) : t("Preparing", "बन रहा है"), lead: t("Your meal is being prepared with care.", "आपका खाना ध्यान से बन रहा है।"), nextTitle: t("What happens next", "आगे क्या होगा"), next: pickup ? t("We will show here when it is ready to collect.", "तैयार होते ही यहाँ दिखेगा।") : t("Once packed, your meal will be ready for rider pickup.", "पैक होते ही खाना राइडर के लिए तैयार होगा।"), help };
  const accepted = status.kitchenStatus === "accepted";
  return { art: <ReceiptArt />, kicker: accepted ? t("Restaurant accepted", "रेस्टोरेंट ने ऑर्डर लिया") : t("Order received", "ऑर्डर मिल गया"), title: eta ?? t("Order placed", "ऑर्डर हो गया"), lead: accepted ? t("The restaurant has accepted your order.", "रेस्टोरेंट ने आपका ऑर्डर ले लिया है।") : t("The restaurant will accept your order shortly.", "रेस्टोरेंट जल्द ही ऑर्डर लेगा।"), nextTitle: t("What happens next", "आगे क्या होगा"), next: `${t("The kitchen starts preparing next.", "अब किचन तैयारी शुरू करेगा।")}${status.paid ? "" : ` ${pickup ? t("Payment is still due at pickup.", "पेमेंट पिकअप पर देना है।") : t("Payment is still due on delivery.", "पेमेंट डिलीवरी पर देना है।")}`}`, help };
}

export function StatusView({ status, hindi, pending, statusMessage, onPay, onRefresh, newOrderHref, outletCode, onBack, reorderHref }: { status: Status; hindi: boolean; outletCode: string; pending: boolean; statusMessage: string; onPay?: () => void; onRefresh: () => void; newOrderHref: string; onBack?: () => void; /** Finished orders only: the same order again */ reorderHref?: string }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const { brand } = useGuestExperience();
  const base = useGuestBase(outletCode);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const pickup = status.serviceMode === "pickup";
  const placed = status.status !== "draft" && status.status !== "cancelled";
  const finished = status.status === "delivered" || status.status === "collected" || status.status === "cancelled";
  const stage = pickup ? status.status === "collected" ? 3 : status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? 2 : status.kitchenStatus === "preparing" ? 1 : 0 : status.status === "delivered" ? 4 : status.status === "dispatched" ? 3 : status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? 2 : status.kitchenStatus === "preparing" ? 1 : 0;
  const steps = pickup
    ? [t("Order placed", "ऑर्डर हो गया"), t("Preparing", "बन रहा है"), t("Ready", "तैयार"), t("Collected", "ले लिया गया")]
    : [t("Order placed", "ऑर्डर हो गया"), t("Preparing", "बन रहा है"), t("Packed", "पैक"), t("On the way", "रास्ते में"), t("Delivered", "पहुँच गया")];
  const cash = status.paymentMode === "cod";
  const method = cash ? (pickup ? t("Pay at pickup", "पिकअप पर पेमेंट") : t("Cash on delivery", "डिलीवरी पर नकद")) : status.paymentMode === "manual_qr" ? t("UPI QR", "UPI QR") : t("Online payment", "ऑनलाइन पेमेंट");
  const head = orderHeadline(status, stage, t, cash && status.paid);
  const locale = hindi ? "hi-IN-u-nu-latn" : "en-IN";
  const placedOn = status.placedAt ? new Date(status.placedAt) : null;
  const placedShort = placedOn ? placedOn.toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
  const subtotal = status.billBreakdown?.subtotalPaise ?? status.items.reduce((n, item) => n + item.unitPricePaise * item.qty, 0);
  const count = status.items.reduce((n, item) => n + item.qty, 0);
  const box = status.status === "cancelled"
    ? { title: status.refundStatus === "none" || !status.refundStatus ? t(`No payment due · ${money(0)}`, `कोई पेमेंट बाकी नहीं · ${money(0)}`) : t(`Refund ${status.refundStatus === "success" ? "returned" : status.refundStatus === "failed" ? "failed" : "in progress"}`, status.refundStatus === "success" ? "रिफंड लौटाया गया" : status.refundStatus === "failed" ? "रिफंड नहीं हुआ" : "रिफंड जारी है"), note: `${t("Not charged", "पैसा नहीं लिया")} · ${method} ${t("cancelled", "रद्द")}` }
    : status.paid ? { title: t(`${money(status.totalPaise)} paid`, `${money(status.totalPaise)} दिया गया`), note: `${t("Paid", "पेमेंट हो गया")} · ${method}` }
      : { title: status.paymentMode === "manual_qr" ? t("Waiting for payment check", "पेमेंट जाँच बाकी") : status.paymentMode === "gateway" ? t("Pay online to start", "शुरू करने के लिए ऑनलाइन पेमेंट करें") : pickup ? t(`${money(status.totalPaise)} due at pickup`, `पिकअप पर ${money(status.totalPaise)} देना है`) : t(`${money(status.totalPaise)} due on delivery`, `डिलीवरी पर ${money(status.totalPaise)} देना है`), note: `${t("Pending", "बाकी")} · ${method}` };
  const row = "flex justify-between gap-3 text-sm";
  const lastUpdate = status.riderLocation ? new Date(status.riderLocation.at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;

  return <div className="grid gap-4">
    <header className="flex items-center gap-3">
      {onBack ? <button type="button" onClick={onBack} aria-label={t("Back to orders", "ऑर्डर पर वापस")} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line bg-surface"><ArrowLeft size={20} aria-hidden /></button>
        : <Link href={base} aria-label={t("Back to home", "मुख्य पेज पर वापस")} className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface"><ArrowLeft size={20} aria-hidden /></Link>}
      <div className="min-w-0 flex-1"><h1 className="text-base font-bold leading-tight">{t("Your order", "आपका ऑर्डर")}</h1><p className="truncate text-xs text-muted">{shortOrderId(status.id)}</p></div>
      <LanguageSwitch />
    </header>
    <div className="flex items-center justify-between gap-3">
      <p className="truncate text-sm font-semibold text-muted">{brand?.outlet.name}</p>
      {brand?.outlet.phone && <a href={`tel:${brand.outlet.phone}`} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-brand"><Headphones size={18} aria-hidden />{t("Help", "मदद")}</a>}
    </div>

    <section aria-label={t("Order status", "ऑर्डर की स्थिति")}>
      <p className="text-sm font-bold text-brand">{head.kicker}</p>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[1.875rem] font-bold leading-[1.15] tracking-tight">{head.title}</h2>
          <p className="mt-2 text-sm">{head.lead ?? statusMessage}</p>
          {placedShort && <p className="mt-1 text-xs text-muted">{t("Order placed", "ऑर्डर का समय")} · {placedShort}</p>}
        </div>
        {head.art && <div className="shrink-0">{head.art}</div>}
      </div>
    </section>

    {!pickup && status.status === "dispatched" && (status.riderLocation ? <section>
      <LiveMap className="h-56" route points={[
        { id: "rider", kind: "rider", lat: status.riderLocation.lat, lng: status.riderLocation.lng, photoUrl: status.courierPhotoUrl, label: status.courierName ?? "Rider" },
        ...(status.address.lat !== undefined && status.address.lng !== undefined ? [{ id: "home", kind: "home" as const, lat: status.address.lat, lng: status.address.lng, label: t("Your door", "आपका घर") }] : []),
      ]} />
      <p className="mt-2 text-xs text-muted">{t("Location last updated", "लोकेशन अपडेट")} · {lastUpdate}</p>
    </section> : <RouteArt label={t("Illustrative route · Not a live map", "सिर्फ़ चित्र · लाइव नक्शा नहीं")} note={t("Waiting for a fresh location update", "नई लोकेशन का इंतज़ार")} />)}

    {status.status !== "cancelled" && status.status !== "draft" && <ol aria-label={t("Order progress", "ऑर्डर की स्थिति")} className="flex items-start">
      {steps.map((step, i) => {
        const complete = status.status === "delivered" || status.status === "collected";
        const done = i < stage || complete, current = i === stage && !complete;
        return <li key={step} aria-current={current ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
          {i > 0 && <span aria-hidden className={`absolute right-1/2 top-3 h-px w-full ${i <= stage ? "bg-brand" : "bg-line"}`} />}
          <span className={`relative grid size-6 place-items-center rounded-full border-2 bg-paper ${done || current ? "border-brand text-brand" : "border-line"}`}>{done ? <Check size={13} strokeWidth={3} aria-hidden /> : current ? <span className="size-2 rounded-full bg-brand" /> : null}</span>
          <span className={`mt-1.5 px-0.5 text-xs leading-tight ${current || (complete && i === steps.length - 1) ? "font-bold text-brand" : ""}`}>{step}</span>
        </li>;
      })}
    </ol>}

    {!pickup && status.courierName && ["dispatched", "delivered"].includes(status.status) && <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
      {status.courierPhotoUrl
        // Rider photos live in the photo bucket, so this stays a plain image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={status.courierPhotoUrl} alt="" className="size-11 shrink-0 rounded-full object-cover" />
        : null}
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{status.courierName}{status.courierVerified && <span className="ml-1.5 text-xs font-bold text-[var(--state-available-text)]">✓ {t("Verified", "सत्यापित")}</span>}</p><p className="truncate text-xs text-muted">{[status.courierRating ? (status.courierRating.rating !== null ? `${status.courierRating.rating.toFixed(1)} (${status.courierRating.ratings})` : t("New rider", "नए राइडर")) : null, status.courierRating ? t(`${status.courierRating.rides} deliveries`, `${status.courierRating.rides} डिलीवरी`) : null, status.courierVehicleNo].filter(Boolean).join(" · ")}</p></div>
      {status.courierPhone && status.status === "dispatched" && <a href={`tel:${status.courierPhone}`} className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-line px-3.5 text-sm font-bold text-brand">{t("Call rider", "राइडर को कॉल")}</a>}
    </section>}

    {!pickup && status.deliveryPin && <section className="flex items-center justify-between gap-4 rounded-2xl bg-brand-soft p-4">
      <div className="min-w-0"><p className="text-sm font-bold">{t("Delivery PIN", "डिलीवरी PIN")}</p><p className="text-xs">{t("Tell this to the rider when your food arrives. Do not share it before.", "खाना पहुँचने पर राइडर को यह बताएँ। पहले किसी को न बताएँ।")}</p></div>
      <p className="shrink-0 font-display text-[2rem] font-bold leading-none tracking-[0.2em] tabular" aria-label={`PIN ${status.deliveryPin.split("").join(" ")}`}>{status.deliveryPin}</p>
    </section>}

    <section className="rounded-2xl bg-brand-soft p-4"><p className="text-sm font-bold">{head.nextTitle}</p><p className="mt-1 text-sm">{head.next}</p></section>

    {placed && !finished && <PushOffer hindi={hindi} outletCode={outletCode} />}

    {!finished && <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-sm font-bold">{t("Order status", "ऑर्डर की स्थिति")}</p><p className="text-xs text-muted">{t("Updates by itself", "अपने आप अपडेट होता है")}</p></div>
      <button type="button" disabled={pending} onClick={onRefresh} className="min-h-11 shrink-0 cursor-pointer rounded-xl border border-line bg-surface px-4 text-sm font-bold text-brand disabled:opacity-50">{pending ? t("Updating…", "अपडेट हो रहा है…") : t("Refresh", "रिफ्रेश")}</button>
    </div>}

    {brand?.outlet.phone && <a href={`tel:${brand.outlet.phone}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
      <Headphones size={20} className="shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1"><b className="block text-sm">{head.help}</b><span className="block text-xs text-muted">{t("Contact the restaurant or get support", "रेस्टोरेंट से बात करें या मदद लें")}</span></span>
      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
    </a>}

    {status.status === "draft" && status.paymentMode === "manual_qr" && status.paymentStatus === "pending" && <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
      <p>{t("UPI reference", "UPI रेफरेंस")}: <strong className="font-mono">{status.manualPaymentReference}</strong></p>
      <p className="text-xs text-muted">{t("The business will verify the payment before sending your order to the kitchen.", "किचन में ऑर्डर भेजने से पहले पेमेंट की पुष्टि की जाएगी।")}</p>
      {status.manualPaymentQrUrl && <Image src={status.manualPaymentQrUrl} alt={t("Business payment QR", "पेमेंट QR")} width={192} height={192} unoptimized className="rounded-lg bg-white p-2" />}
    </section>}

    <section className="rounded-2xl border border-line bg-surface px-4 pb-4 pt-2.5" aria-label={t("Order summary", "ऑर्डर का सारांश")}>
      <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-line" />
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-3 flex w-full cursor-pointer items-center justify-between gap-3 text-left">
        <span><b className="block text-base">{t("Order summary", "ऑर्डर का सारांश")}</b><span className="text-sm text-muted">{count > 0 ? t(`${count} ${count === 1 ? "item" : "items"}`, `${count} आइटम`) : t("Items", "आइटम")} · {status.status === "cancelled" ? t("Original value", "मूल राशि") : t("Total", "कुल")} {money(status.totalPaise)}</span></span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div className="mt-3 divide-y divide-line [&>*]:py-3 [&>*:last-child]:pb-0">
        {status.items.length > 0 ? <ul className="grid gap-3">
          {status.items.map((item, i) => <li key={i} className="flex items-center gap-3"><Thumb photo={item.imageUrl} size="size-14" /><span className="min-w-0 flex-1"><b className="block text-sm">{item.qty} × {(hindi && item.nameHi) || item.name}</b>{item.modifiers?.length ? <span className="mt-0.5 block text-xs text-muted">{item.modifiers.map((m) => (hindi && m.nameHi) || m.nameEn).join(" · ")}</span> : null}</span><b className="shrink-0 text-sm tabular">{money(item.unitPricePaise * item.qty)}</b></li>)}
        </ul> : <div><p className="text-sm font-bold">{t("Items", "आइटम")}</p><p className="mt-1 text-sm text-muted">{t("Item names are unavailable in this record.", "इस रिकॉर्ड में आइटम के नाम नहीं हैं।")}</p></div>}
        <div className="grid gap-2">
          {subtotal > 0 && <p className={`${row} text-muted`}><span>{t("Item subtotal", "आइटम का कुल")}</span><span className="tabular">{money(subtotal)}</span></p>}
          {!!status.billBreakdown?.discountPaise && <p className={`${row} text-brand`}><span>{t("Discount", "छूट")}</span><span className="tabular">−{money(status.billBreakdown.discountPaise)}</span></p>}
          {!!status.billBreakdown?.taxPaise && <p className={`${row} text-muted`}><span>{t("Tax", "टैक्स")}</span><span className="tabular">{money(status.billBreakdown.taxPaise)}</span></p>}
          {status.deliveryFeePaise > 0 && <p className={`${row} text-muted`}><span>{t("Delivery charge", "डिलीवरी शुल्क")}</span><span className="tabular">{money(status.deliveryFeePaise)}</span></p>}
          {!!status.billBreakdown?.serviceChargePaise && <p className={`${row} text-muted`}><span>{t("Service charge", "सर्विस शुल्क")}</span><span className="tabular">{money(status.billBreakdown.serviceChargePaise)}</span></p>}
          {!!status.billBreakdown?.roundOffPaise && <p className={`${row} text-muted`}><span>{t("Round off", "राउंड ऑफ़")}</span><span className="tabular">{money(status.billBreakdown.roundOffPaise)}</span></p>}
          <p className={`${row} font-bold`}><span>{status.status === "cancelled" ? t("Original order value", "ऑर्डर की मूल राशि") : t("Bill total", "बिल का कुल")}</span><span className="text-base tabular">{money(status.totalPaise)}</span></p>
          <div className="mt-1 rounded-xl bg-brand-soft p-3"><p className="text-sm font-bold">{box.title}</p><p className="mt-0.5 text-sm">{box.note}</p></div>
          {status.paymentFailureReason && <p role="status" className="rounded-xl bg-brand-soft p-3 text-xs">{status.paymentFailureReason}</p>}
          {status.status === "draft" && status.paymentStatus === "pending" && status.paymentMode === "gateway" && onPay && <button type="button" disabled={pending} className={button} onClick={onPay}>{t("Continue secure payment", "सुरक्षित पेमेंट जारी रखें")}</button>}
          {status.billPdfUrl && <a href={status.billPdfUrl} className="mt-1 flex min-h-12 items-center justify-center rounded-xl border border-line text-sm font-bold text-brand">{status.status === "cancelled" ? t("Download order record", "ऑर्डर रिकॉर्ड डाउनलोड करें") : t("Download bill", "बिल डाउनलोड करें")}</a>}
        </div>
        {pickup ? brand?.outlet.address && <div><p className="text-sm font-bold">{t("Collect from", "यहाँ से लें")}</p><p className="mt-1 text-sm text-muted">{brand.outlet.address}, {brand.outlet.city}</p></div>
          : <div><p className="text-sm font-bold">{status.status === "cancelled" ? t("Delivery address on order", "ऑर्डर का डिलीवरी पता") : t("Delivering to", "यहाँ डिलीवरी")}{status.status !== "cancelled" && status.name ? ` · ${status.name}` : ""}</p><p className="mt-1 text-sm text-muted">{status.address.line ? `${status.address.line}, ${status.address.locality} · ${status.address.pincode}` : t("Address is not available in this record.", "इस रिकॉर्ड में पता नहीं है।")}</p></div>}
        <div>
          <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">{t("Order details", "ऑर्डर की जानकारी")}</p><button type="button" onClick={() => { void navigator.clipboard.writeText(status.id).then(() => setCopied(true), () => setCopied(false)); }} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-sm font-bold text-brand"><Copy size={16} className="text-ink" aria-hidden />{copied ? t("Copied", "कॉपी हो गया") : t("Copy ID", "ID कॉपी करें")}</button></div>
          <p className="mt-1 break-all text-sm text-muted">{status.id}</p>
          {placedOn && <p className="mt-1 text-sm text-muted">{t("Placed", "ऑर्डर")} {placedOn.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · {placedOn.toLocaleTimeString(locale, { timeZone: "Asia/Kolkata" })}</p>}
          <p className="mt-1 text-sm text-muted">{brand?.outlet.name} · {pickup ? t("Pickup", "पिकअप") : t("Delivery", "डिलीवरी")}</p>
        </div>
      </div>}
    </section>

    {!pickup && status.status === "delivered" && (status.canRate || status.myRating) && <RateRider outletCode={outletCode} hindi={hindi} name={status.courierName} given={status.myRating} rider={status.courierRating} />}

    {finished && reorderHref
      ? <Link href={reorderHref} className="flex min-h-12 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-on">{t("Reorder · Review cart", "फिर से ऑर्डर · कार्ट देखें")}</Link>
      : <Link href={newOrderHref.replace("?new=1", `?mode=${pickup ? "pickup" : "delivery"}&new=1`)} className={`flex min-h-12 items-center justify-center rounded-xl text-sm font-bold ${finished ? "bg-brand text-brand-on" : "border border-line bg-surface text-brand"}`}>{t("Start another order", "नया ऑर्डर करें")}</Link>}
  </div>;
}

/** After delivery: one tap of stars for the rider, with an optional word */
function RateRider({ outletCode, hindi, name, given, rider }: { outletCode: string; hindi: boolean; name: string | null; given: number | null; rider: Status["courierRating"] }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const [stars, setStars] = useState(given ?? 0);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(given !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = [t("Bad", "खराब"), t("Not good", "ठीक नहीं"), t("Okay", "ठीक"), t("Good", "अच्छा"), t("Excellent", "बहुत बढ़िया")];
  if (done) return <section className="rounded-[22px] border border-line/70 bg-surface p-4 text-center">
    <p className="text-[1.5rem] leading-none text-[var(--state-held)]" aria-label={t(`${stars} stars`, `${stars} स्टार`)}>{"★".repeat(stars)}<span className="text-ink/15">{"★".repeat(5 - stars)}</span></p>
    <p className="mt-2 text-caption font-semibold text-success">{t("Thanks for rating your rider!", "राइडर को रेटिंग देने के लिए धन्यवाद!")}</p>
  </section>;
  return <section className="rounded-[22px] border border-line/70 bg-surface p-4">
    <p className="text-base font-bold">{t("How was your delivery?", "डिलीवरी कैसी रही?")}</p>
    <p className="mt-1 text-sm text-muted">{[name, rider?.rating != null ? `${rider.rating.toFixed(1)} (${rider.ratings})` : null, rider ? t(`${rider.rides} deliveries`, `${rider.rides} डिलीवरी`) : null].filter(Boolean).join(" · ")}</p>
    <div role="radiogroup" aria-label={t("Rider rating", "राइडर रेटिंग")} className="mt-3 flex gap-2">
      {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} · ${labels[n - 1]}`} onClick={() => setStars(n)} className={`grid size-12 cursor-pointer place-items-center rounded-xl border border-line text-[1.5rem] leading-none transition-transform active:scale-90 ${n <= stars ? "text-[var(--state-held)]" : "text-muted"}`}>{n <= stars ? "★" : "☆"}</button>)}
    </div>
    <p className="mt-2 text-sm text-muted">{stars ? labels[stars - 1] : t("Optional · Not rated yet", "वैकल्पिक · अभी रेटिंग नहीं")}</p>
    {stars > 0 && <>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("Anything to add? (optional)", "कुछ कहना है? (वैकल्पिक)")} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-body" />
      {error && <p role="alert" className="mt-2 text-caption font-semibold text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(null); void rateRiderAction(outletCode, stars, note).then((r) => { setBusy(false); if (r.ok) setDone(true); else setError(r.message); }); }} className="mt-3 min-h-12 w-full rounded-2xl bg-brand text-body font-bold text-brand-on disabled:opacity-60">{busy ? t("Sending…", "भेज रहे हैं…") : t("Submit rating", "रेटिंग भेजें")}</button>
    </>}
  </section>;
}

/** One bar for the two goals a delivery cart chases: the minimum order, then free delivery */
function OrderGoals({ hindi, cartPaise, minimumPaise, freeAbovePaise, feePaise }: { hindi: boolean; cartPaise: number; minimumPaise: number; freeAbovePaise: number | null; feePaise: number }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const free = feePaise > 0 && freeAbovePaise !== null ? freeAbovePaise : null;
  const goals = [
    ...(minimumPaise > 0 ? [{ at: minimumPaise, label: t("Min. order", "न्यूनतम ऑर्डर") }] : []),
    ...(free !== null && free !== minimumPaise ? [{ at: free, label: t("Free delivery", "मुफ़्त डिलीवरी") }] : []),
  ].sort((a, b) => a.at - b.at);
  if (free !== null && free === minimumPaise && goals[0]) goals[0].label = t("Min. order · free delivery", "न्यूनतम · मुफ़्त डिलीवरी");
  const fee = feePaise ? `${t("Delivery", "डिलीवरी")} ${money(feePaise)}` : t("Free delivery", "मुफ़्त डिलीवरी");
  if (!goals.length) return <p className="mt-1 border-t border-line/70 pt-2.5 text-caption text-muted">{fee}</p>;
  const belowMin = cartPaise < minimumPaise;
  const freeDone = free === null || cartPaise >= free;
  const message = belowMin
    ? t(`Add ${money(minimumPaise - cartPaise)} more to place your order`, `ऑर्डर के लिए ${money(minimumPaise - cartPaise)} और जोड़ें`)
    : !freeDone
      ? t(`Add ${money(free! - cartPaise)} more for free delivery`, `मुफ़्त डिलीवरी के लिए ${money(free! - cartPaise)} और जोड़ें`)
      : free !== null ? t("Free delivery unlocked", "मुफ़्त डिलीवरी मिल गई") : t("Ready to order", "ऑर्डर के लिए तैयार");
  // One track per goal, sized by how far it reaches; each label sits under its own track, so none runs off the card
  return <div className="mt-1 border-t border-line/70 pt-3" role="status">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <p className={`text-caption font-bold ${belowMin ? "text-[var(--state-held-text)]" : "text-success"}`}>{message}</p>
      <p className="text-caption text-muted">{free !== null && cartPaise >= free ? <span className="line-through">{fee}</span> : fee}</p>
    </div>
    <div className="mt-2.5 flex gap-1" aria-hidden>
      {goals.map((g, k) => {
        const from = k ? goals[k - 1].at : 0, done = cartPaise >= g.at;
        const fill = Math.max(0, Math.min(1, (cartPaise - from) / (g.at - from)));
        return <div key={g.at} className="min-w-[5.5rem]" style={{ flexGrow: g.at - from, flexBasis: 0 }}>
          <div className="h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-[var(--state-available)] transition-[width] duration-500" style={{ width: `${fill * 100}%` }} /></div>
          <p className={`mt-1.5 text-right text-[11px] leading-tight ${done ? "font-semibold text-success" : "text-muted"}`}>
            <span className="font-semibold tabular">{done ? "✓ " : ""}{money(g.at)}</span><br />{g.label}
          </p>
        </div>;
      })}
    </div>
  </div>;
}

/** "Use my location", then a map whose pin the guest drags to their exact door */
function ExactPin({ hindi, address, onPin, onPlace }: { hindi: boolean; address: DeliveryAddress; onPin: (p: { lat: number; lng: number }) => void; onPlace: (place: { pincode: string; locality: string; line: string }) => boolean }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPin = address.lat !== undefined && address.lng !== undefined;
  const locate = () => {
    if (!("geolocation" in navigator)) { setError(t("This phone cannot share location.", "यह फ़ोन लोकेशन नहीं दे सकता।")); return; }
    setBusy(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onPin(p);
        // Fill pincode, area and street from the location; the guest can still edit every field
        void placeAction(p.lat, p.lng).then((place) => { setBusy(false); if (place) { if (!onPlace(place)) setError(t("Address filled from your location. Please type your pincode above.", "लोकेशन से पता भर दिया। कृपया ऊपर अपना पिनकोड लिखें।")); } else setError(t("Location found. Please type the address below.", "लोकेशन मिल गई। कृपया नीचे पता लिखें।")); }, () => setBusy(false));
      },
      (err) => { setBusy(false); setError(err.code === err.PERMISSION_DENIED ? t("Allow location in your browser, or just type the address.", "ब्राउज़र में लोकेशन की अनुमति दें, या पता लिखें।") : t("Could not find you. Turn on GPS and try again.", "लोकेशन नहीं मिली। GPS चालू करके फिर कोशिश करें।")); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  return <div className="grid gap-2">
    <button type="button" onClick={locate} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-brand/40 bg-brand-soft/50 px-4 text-caption font-bold text-brand-strong disabled:opacity-60">
      <HugeiconsIcon icon={Location01Icon} size={17} aria-hidden />{busy ? t("Finding you…", "लोकेशन ढूँढ रहे हैं…") : hasPin ? t("Use my current location again", "फिर से मेरी लोकेशन लें") : t("Use my current location", "मेरी अभी की लोकेशन लें")}
    </button>
    {error && <p role="status" className="text-caption text-muted">{error}</p>}
    {hasPin && <>
      <LiveMap className="h-48" points={[{ id: "home", kind: "home", lat: address.lat!, lng: address.lng!, label: t("Your door", "आपका घर") }]} onHomeMove={onPin} />
      <p className="text-caption text-muted">{t("Drag the pin or tap the map to mark your exact door. The rider sees this spot.", "पिन खिसकाकर या नक्शे पर टैप करके अपना सही दरवाज़ा चुनें। राइडर को यही जगह दिखेगी।")}</p>
    </>}
  </div>;
}

/** "Get updates on this phone": a push when the order is confirmed, leaves and arrives */
function PushOffer({ hindi, outletCode }: { hindi: boolean; outletCode: string }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  const [state, setState] = useState<"idle" | "busy" | "on" | "blocked" | "hidden">("hidden");
  // Decided after the page loads, since the server cannot know what this browser supports
  useEffect(() => { queueMicrotask(() => setState(!guestPushSupported() ? "hidden" : Notification.permission === "denied" ? "blocked" : "idle")); }, []);
  if (state === "hidden") return null;
  if (state === "on") return <p className="rounded-2xl bg-[var(--state-available-soft)] px-4 py-3 text-caption font-semibold text-[var(--state-available-text)]">🔔 {t("Updates are on for this phone.", "इस फ़ोन पर अपडेट चालू हैं।")}</p>;
  if (state === "blocked") return <p className="rounded-2xl bg-ink/5 px-4 py-3 text-caption text-muted">{t("Notifications are blocked for this site. Allow them in your browser settings to get updates.", "इस साइट की सूचनाएँ बंद हैं। अपडेट पाने के लिए ब्राउज़र सेटिंग में अनुमति दें।")}</p>;
  return <button type="button" disabled={state === "busy"} onClick={() => { setState("busy"); void enableGuestPush(pushKeyAction, (sub) => deliveryPushAction(outletCode, sub)).then((r) => setState(r.ok ? "on" : r.error === "blocked" ? "blocked" : r.error === "off" || r.error === "unsupported" ? "hidden" : "idle")); }}
    className="flex w-full items-center gap-3 rounded-[22px] border border-brand/30 bg-brand-soft/50 p-4 text-left disabled:opacity-60">
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-lg text-brand-on" aria-hidden>🔔</span>
    <span className="min-w-0 flex-1"><span className="block text-body font-bold">{state === "busy" ? t("Turning on…", "चालू कर रहे हैं…") : t("Get updates on this phone", "इस फ़ोन पर अपडेट पाएँ")}</span><span className="block text-caption text-muted">{t("We will tell you when your food leaves and arrives.", "खाना निकलने और पहुँचने पर हम बताएँगे।")}</span></span>
  </button>;
}
