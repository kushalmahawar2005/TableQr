"use client";
import { Cancel01Icon, FilterHorizontalIcon, MinusSignIcon, PlusSignIcon, Search01Icon, ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import type { DeliveryAddress, DeliveryCartLine } from "@/db/schema/delivery";
import type { deliveryMenu, priceDeliveryCart } from "@/server/delivery/catalog";
import type { deliveryStatus } from "@/server/delivery/checkout";
import { priceLine } from "@/domain/pricing";
import { openCheckout } from "@/lib/payments/checkout";
import { OutletLogo } from "../t/[table]/_components/outlet-logo";
import { CategoryBar } from "../t/[table]/menu/_components/category-bar";
import { Thumb, VegMark } from "../t/[table]/menu/_components/menu-row";
import { claimManualQrDeliveryAction, deliveryStatusAction, placeDeliveryAction, quoteDeliveryAction, resendDeliveryAction, startDeliveryAction, startDeliveryPaymentAction, verifyDeliveryAction } from "./actions";

type Menu = Awaited<ReturnType<typeof deliveryMenu>>;
type Quote = Awaited<ReturnType<typeof priceDeliveryCart>>;
type Status = Awaited<ReturnType<typeof deliveryStatus>>;
const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const control = "min-h-12 w-full rounded-2xl border border-line/70 bg-surface px-4 text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]";
const button = "min-h-13 w-full rounded-2xl bg-brand px-4 font-bold text-brand-on shadow-[0_8px_20px_-6px_var(--brand-border)] disabled:opacity-50 disabled:shadow-none";

export function DeliveryScreen({ outletCode, data, initialStatus, hindi: initialHindi = false }: { outletCode: string; data?: Menu; initialStatus?: Status; hindi?: boolean }) {
  const [hindi, setHindi] = useState(initialHindi);
  const t = (en: string, hi: string) => hindi ? hi : en;
  const [cart, setCart] = useState<DeliveryCartLine[]>([]);
  const [step, setStep] = useState<"menu" | "address" | "otp" | "review">("menu");
  const [address, setAddress] = useState<DeliveryAddress>({ line: "", locality: "", pincode: "", instructions: "" });
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [otpCode, setOtpCode] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [otp, setOtp] = useState<{ challengeId: string; devCode?: string; resendIn: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null), [status, setStatus] = useState<Status | undefined>(initialStatus);
  const [error, setError] = useState<string | null>(null), [pending, start] = useTransition();
  const [selected, setSelected] = useState<Menu["items"][number] | null>(null), [choices, setChoices] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const statusCode = status?.status;
  useEffect(() => {
    if (!statusCode || ["delivered", "cancelled"].includes(statusCode)) return;
    let busy = false;
    const timer = setInterval(async () => { if (document.hidden || busy) return; busy = true; try { const response = await deliveryStatusAction(outletCode); if (response.ok) setStatus(response.data); } finally { busy = false; } }, 10000);
    return () => clearInterval(timer);
  }, [outletCode, statusCode]);
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
  const totalQty = cart.reduce((sum, line) => sum + line.qty, 0);
  // Food only, before tax and delivery; the review step shows the full bill
  const cartPaise = cart.reduce((sum, line) => {
    const item = data?.items.find(i => i.id === line.itemId);
    const priced = item ? priceLine(item.pricing, line.qty, line.modifierIds) : null;
    return sum + (priced?.ok ? priced.line.linePaise : 0);
  }, 0);
  // Older/stale menu payloads can omit one of these collections. Keep the guest
  // page usable instead of crashing during render while the menu is refreshed.
  const menuItems = Array.isArray(data?.items) ? data.items : [];
  const menuCategories = Array.isArray(data?.categories) ? data.categories : [];
  const visibleItems = menuItems.filter(item => `${item.name} ${item.nameHi ?? ""} ${item.description ?? ""} ${item.descriptionHi ?? ""}`.toLowerCase().includes(search.toLowerCase()));
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
  const statusMessage = !status ? "" : status.status === "draft" && status.paymentStatus === "pending" && status.paymentMode === "manual_qr" ? t("Payment reference submitted · waiting for restaurant verification", "पेमेंट रेफरेंस भेज दिया · रेस्टोरेंट की पुष्टि का इंतज़ार") : status.status === "draft" && status.paymentStatus === "pending" ? t("Checking your payment securely…", "आपका पेमेंट सुरक्षित रूप से जाँचा जा रहा है…") : status.status === "draft" && status.paymentStatus.startsWith("refund") ? t("Payment received · refund in progress", "पेमेंट मिला · रिफंड चल रहा है") : status.status === "draft" && status.paymentStatus === "failed" ? t("Payment was not completed. No order was placed.", "पेमेंट पूरा नहीं हुआ। ऑर्डर नहीं हुआ।") : status.status === "placed" ? t(status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "Packed · awaiting dispatch" : "Restaurant is preparing your order", status.kitchenStatus === "ready" || status.kitchenStatus === "served" ? "पैक हो गया · भेजने की तैयारी" : "रेस्टोरेंट आपका ऑर्डर तैयार कर रहा है") : status.status === "dispatched" ? t("Your order is on the way", "आपका ऑर्डर रास्ते में है") : status.status === "delivered" ? t("Delivered", "डिलीवर हो गया") : status.status === "cancelled" ? t("Cancelled", "रद्द किया गया") : t("Complete payment to continue", "जारी रखने के लिए पेमेंट पूरा करें");
  return <main lang={hindi ? "hi" : "en"} className="flex w-full min-w-0 flex-col pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] text-ink">
    <header className="flex items-center gap-2.5">
      {data ? <Link href={`/r/${encodeURIComponent(outletCode)}`} aria-label={t("Back to restaurant", "रेस्टोरेंट पर वापस")} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-brand">
        <OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-display text-section leading-tight font-bold">{data.outlet.name}</span>
          <span className="block text-caption text-muted">{t("Home delivery", "घर पर डिलीवरी")} · {data.outlet.policy.estimatedMinutes} {t("min", "मिनट")}</span>
        </span>
      </Link> : <Link href={`/r/${encodeURIComponent(outletCode)}`} className="flex-1 text-caption font-semibold text-muted">← {t("Restaurant", "रेस्टोरेंट")}</Link>}
      <div role="group" aria-label={t("Language", "भाषा")} className="flex shrink-0 rounded-full border border-line/70 bg-surface p-0.5 text-caption font-semibold shadow-[0_1px_3px_rgb(31_41_55/0.05)]">
        {([[false, "EN"], [true, "HI"]] as const).map(([hi, label]) => <button key={label} type="button" aria-pressed={hindi === hi} onClick={() => setHindi(hi)} className={`min-h-9 min-w-10 rounded-full px-2.5 transition-colors ${hindi === hi ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{label}</button>)}
      </div>
      {!status && <button type="button" disabled={!cart.length} onClick={() => setStep("address")} aria-label={t(`Your cart, ${totalQty} items`, `आपका कार्ट, ${totalQty} आइटम`)} className="relative grid size-11 shrink-0 place-items-center rounded-full border border-line/70 bg-surface text-ink shadow-[0_2px_8px_rgb(31_41_55/0.06)] hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default">
        <HugeiconsIcon icon={ShoppingBasket01Icon} size={21} aria-hidden />
        {totalQty > 0 && <span aria-hidden className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-label font-bold tabular text-brand-on ring-2 ring-paper">{totalQty}</span>}
      </button>}
    </header>
    {error && <p role="alert" className="mt-4 rounded-2xl border border-danger/20 bg-[var(--state-seated-soft)] p-4 text-caption font-semibold text-danger">{error}</p>}
    {status ? <section className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
      <h1 className="text-2xl font-bold">{status.status === "draft" ? t("Delivery payment", "डिलीवरी पेमेंट") : t("Your delivery order", "आपका डिलीवरी ऑर्डर")}</h1>
      <p className="font-semibold">{statusMessage}</p>
      <p className="text-sm text-muted">{status.address.line}, {status.address.locality} · {status.address.pincode}</p>
      {status.status === "draft" && status.paymentMode === "manual_qr" && status.paymentStatus === "pending" && <div className="space-y-2 rounded-xl bg-brand-soft p-3 text-sm"><p>{t("UPI reference", "UPI रेफरेंस")}: <strong className="font-mono">{status.manualPaymentReference}</strong></p><p>{t("The restaurant will verify the payment before sending your order to the kitchen.", "रेस्टोरेंट किचन में ऑर्डर भेजने से पहले पेमेंट की पुष्टि करेगा।")}</p>{status.manualPaymentQrUrl && <Image src={status.manualPaymentQrUrl} alt={t("Restaurant payment QR", "रेस्टोरेंट का पेमेंट QR")} width={192} height={192} unoptimized className="rounded-lg bg-white p-2" />}</div>}
      {status.courierName && status.courierPhone && ["dispatched", "delivered"].includes(status.status) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-soft p-4"><div><p className="text-sm text-muted">{t("Your delivery rider", "आपका डिलीवरी राइडर")}</p><p className="font-semibold">{status.courierName}</p></div><a href={`tel:${status.courierPhone}`} className="min-h-11 rounded-xl bg-surface px-4 py-3 text-sm font-semibold text-brand-strong">{t("Call rider", "राइडर को कॉल करें")}</a></div>}
      <p className="text-xl font-bold">{money(status.totalPaise)}</p><p className="text-sm text-muted">{status.paid ? t("Paid to the restaurant", "रेस्टोरेंट को पेमेंट हो गया") : status.paymentMode === "gateway" ? t("Pay the restaurant online before it starts preparing your order.", "ऑर्डर तैयार होने से पहले रेस्टोरेंट को ऑनलाइन पेमेंट करें।") : status.paymentMode === "manual_qr" ? t("Pay using the restaurant QR. Preparation starts after staff verifies payment.", "रेस्टोरेंट QR से पेमेंट करें। स्टाफ पुष्टि के बाद ऑर्डर तैयार होगा।") : t("Pay on delivery", "डिलीवरी पर भुगतान करें")}</p>
      {status.paymentFailureReason && <p role="status" className="rounded-xl bg-brand-soft p-3 text-sm">{status.paymentFailureReason}</p>}{status.status === "draft" && status.paymentStatus === "pending" && status.paymentMode === "gateway" && <button type="button" disabled={pending} className={button} onClick={() => run(payDelivery)}>{t("Continue secure payment", "सुरक्षित पेमेंट जारी रखें")}</button>}
      <button type="button" disabled={pending} className={control} onClick={() => run(loadStatus)}>{t("Refresh status", "स्थिति देखें")}</button><Link href={`/r/${encodeURIComponent(outletCode)}/delivery?new=1&lang=${hindi ? "hi" : "en"}`} className="block py-2 text-center text-sm text-brand-strong">{t("Start another order", "नया ऑर्डर करें")}</Link>
    </section> : <>
    {step === "menu" && data && <>
      <div className="mt-5">
        <h1 className="font-display text-[1.625rem] leading-tight font-bold tracking-tight">{t("What are you craving?", "आज क्या खाने का मन है?")}</h1>
        <p className="mt-1 text-body text-muted">{t(`Freshly prepared, delivered in about ${data.outlet.policy.estimatedMinutes} minutes. ${data.outlet.policy.paymentMode === "gateway" ? "Pay securely before preparation." : data.outlet.policy.paymentMode === "manual_qr" ? "Pay using the restaurant QR." : "Pay when your order arrives."}`, `ताज़ा तैयार, लगभग ${data.outlet.policy.estimatedMinutes} मिनट में डिलीवरी। ${data.outlet.policy.paymentMode === "gateway" ? "तैयारी से पहले सुरक्षित पेमेंट करें।" : data.outlet.policy.paymentMode === "manual_qr" ? "रेस्टोरेंट QR से पेमेंट करें।" : "ऑर्डर मिलने पर भुगतान करें।"}`)}</p>
      </div>
      <form role="search" onSubmit={event => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }} className="mt-4">
        <label className="relative block">
          <span className="sr-only">{t("Search menu", "मेन्यू में खोजें")}</span>
          <HugeiconsIcon icon={Search01Icon} size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand" aria-hidden />
          <input type="search" enterKeyHint="search" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Search paneer, dosa, coffee…", "पनीर, डोसा, कॉफ़ी खोजें…")} className="h-[52px] w-full rounded-2xl border border-line/70 bg-surface pr-12 pl-12 text-body text-ink shadow-[0_2px_10px_rgb(31_41_55/0.05)] outline-none placeholder:text-muted/80 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] [&::-webkit-search-cancel-button]:hidden" />
          {search ? <button type="button" onClick={() => setSearch("")} aria-label={t("Clear search", "खोज साफ़ करें")} className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"><HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden /></button>
            : <HugeiconsIcon icon={FilterHorizontalIcon} size={20} className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted/70" aria-hidden />}
        </label>
      </form>
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
                  : !qty ? <button type="button" onClick={addOne} aria-label={t(`Add ${itemName}`, `${itemName} जोड़ें`)} className="relative flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-body font-bold text-brand-on shadow-[0_4px_12px_-2px_var(--brand-border)] transition-[transform,background-color] duration-100 before:absolute before:-inset-1 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.96]"><HugeiconsIcon icon={PlusSignIcon} size={17} strokeWidth={2.6} aria-hidden />{t("Add", "जोड़ें")}</button>
                  : <div role="group" aria-label={t(`${qty} × ${itemName}`, `${qty} × ${itemName}`)} className="flex h-10 min-w-[96px] items-center justify-between gap-1 rounded-xl bg-brand text-brand-on shadow-[0_4px_12px_-2px_var(--brand-border)]">
                    <button type="button" aria-label={t(`Remove ${itemName}`, `${itemName} हटाएँ`)} onClick={() => removeOne(item.id)} className="grid h-full w-9 place-items-center active:scale-90"><HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2.4} aria-hidden /></button>
                    <span aria-live="polite" className="min-w-6 text-center text-body font-bold tabular">{qty}</span>
                    <button type="button" aria-label={t(`Add ${itemName}`, `${itemName} जोड़ें`)} onClick={addOne} className="grid h-full w-9 place-items-center active:scale-90"><HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2.4} aria-hidden /></button>
                  </div>}
              </div>
            </li>;
          })}
        </ul>
      </section>)}
      {visibleCategories.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center text-caption text-muted">{menuItems.length > 0 ? t("No dishes match your search.", "आपकी खोज से कोई डिश नहीं मिली।") : t("No delivery dishes are available right now.", "अभी डिलीवरी के लिए कोई डिश उपलब्ध नहीं है।")}</p>}
      {cart.length > 0 && <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] px-4 pb-[max(12px,env(safe-area-inset-bottom))] min-[360px]:px-5">
        <button type="button" onClick={() => setStep("address")} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-brand px-4 py-2.5 text-left text-brand-on shadow-[0_12px_28px_-8px_var(--brand-border)] transition-transform active:scale-[0.99]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20"><HugeiconsIcon icon={ShoppingBasket01Icon} size={19} aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block text-label opacity-85">{t(`${totalQty} ${totalQty === 1 ? "item" : "items"}`, `${totalQty} आइटम`)}</span><span className="block text-body font-bold tabular">{money(cartPaise)} <span className="text-label font-medium opacity-80">{t("+ taxes", "+ टैक्स")}</span></span></span>
          <span className="text-body font-bold">{t("View cart", "कार्ट देखें")} →</span>
        </button>
      </div>}
    </>}
    {selected && <section role="dialog" aria-modal="true" aria-label={selected.name} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"><div className="max-h-[85dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-surface p-5"><div className="flex justify-between gap-3"><h2 className="font-bold">{selected.name}</h2><button type="button" onClick={() => setSelected(null)} className="min-h-11 px-3" aria-label="Close">✕</button></div>{selected.pricing.groups.map(group => <fieldset key={group.id} className="space-y-2"><legend className="font-semibold">{group.nameEn} · {group.minSelect > 0 ? t("Required", "ज़रूरी") : t("Optional", "वैकल्पिक")}</legend>{group.modifiers.map(option => <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={choices.includes(option.id)} onChange={event => setChoices(current => event.target.checked ? group.maxSelect === 1 ? [...current.filter(id => !group.modifiers.some(modifier => modifier.id === id)), option.id] : [...current, option.id] : current.filter(id => id !== option.id))} />{option.nameEn} {option.priceDeltaPaise ? `+ ${money(option.priceDeltaPaise)}` : ""}</label>)}</fieldset>)}<button type="button" className={button} onClick={() => add(selected, choices)}>{t("Add to cart", "कार्ट में जोड़ें")}</button></div></section>}
    {step !== "menu" && <div className="mt-5 space-y-4"><button type="button" disabled={pending} onClick={() => { setStep("menu"); setQuote(null); }} className="min-h-11 text-sm text-brand-strong">← {t("Edit cart", "कार्ट बदलें")}</button><h1 className="text-2xl font-bold">{t(step === "otp" ? "Verify your phone" : step === "review" ? "Review and place order" : "Delivery details", step === "otp" ? "फ़ोन सत्यापित करें" : step === "review" ? "ऑर्डर की पुष्टि करें" : "डिलीवरी की जानकारी")}</h1>
      {step === "address" && <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { const response = await startDeliveryAction(outletCode, cart, address, phone); if (!response.ok) { setError(response.message); return; } setOtp(response.data.otp); setResendAt(Date.now() + response.data.otp.resendIn * 1000); setQuote(response.data.quote); setStep("otp"); }); }}>
        {cart.map((line, index) => <div key={index} className="flex items-center gap-3 rounded-xl border border-line p-3"><p className="min-w-0 flex-1 text-sm">{data?.items.find(item => item.id === line.itemId)?.name}</p><button type="button" aria-label="Remove one" className="min-h-11 px-3" onClick={() => setCart(current => current.map((value, i) => i === index ? { ...value, qty: value.qty - 1 } : value).filter(value => value.qty > 0))}>−</button><span>{line.qty}</span><button type="button" aria-label="Add one" className="min-h-11 px-3" onClick={() => setCart(current => current.map((value, i) => i === index ? { ...value, qty: Math.min(20, value.qty + 1) } : value))}>+</button></div>)}
        <label className="block space-y-2 text-sm font-semibold">{t("Name", "नाम")}<input required maxLength={40} autoComplete="name" className={control} value={name} onChange={event => setName(event.target.value)} /></label><label className="block space-y-2 text-sm font-semibold">{t("Mobile number (+91)", "मोबाइल नंबर (+91)")}<input required inputMode="tel" type="tel" autoComplete="tel-national" maxLength={15} className={control} value={phone} onChange={event => setPhone(event.target.value)} /></label>
        {([ ["line", t("House / flat and street", "घर / फ्लैट और सड़क")], ["locality", t("Locality and city", "इलाका और शहर")], ["pincode", t("Pincode", "पिनकोड")], ["instructions", t("Delivery instructions (optional)", "डिलीवरी निर्देश (वैकल्पिक)")] ] as const).map(([key, label]) => <label key={key} className="block space-y-2 text-sm font-semibold">{label}<input className={control} required={key !== "instructions"} inputMode={key === "pincode" ? "numeric" : "text"} maxLength={key === "pincode" ? 6 : key === "locality" ? 100 : 200} autoComplete={key === "pincode" ? "postal-code" : key === "line" ? "street-address" : "off"} value={address[key]} onChange={event => setAddress(current => ({ ...current, [key]: event.target.value }))} /></label>)}<button disabled={pending || !cart.length} className={button}>{pending ? t("Checking…", "जाँच रहे हैं…") : t("Continue · send code", "आगे बढ़ें · कोड भेजें")}</button>
      </form>}
      {step === "otp" && otp && <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { const response = await verifyDeliveryAction(outletCode, otp.challengeId, otpCode, name); if (!response.ok) { setError(response.message); return; } setStep("review"); }); }}><p className="text-sm text-muted">{t(`Enter the four-digit code sent to ${phone}.`, `${phone} पर भेजा गया चार अंकों का कोड दर्ज करें।`)}</p>{otp.devCode && <p className="rounded-xl bg-brand-soft p-3 text-sm">{t("Demo code", "डेमो कोड")}: <strong>{otp.devCode}</strong></p>}<input aria-label="Verification code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className={control} value={otpCode} onChange={event => setOtpCode(event.target.value.replace(/\D/g, ""))} /><button disabled={pending} className={button}>{t("Verify phone", "फ़ोन सत्यापित करें")}</button><button type="button" disabled={pending} className={control} onClick={() => run(async () => { if (Date.now() < resendAt) { setError(t("Wait 30 seconds before resending.", "दोबारा भेजने से पहले 30 सेकंड रुकें।")); return; } const response = await resendDeliveryAction(outletCode, phone); if (!response.ok) { setError(response.message); return; } setOtp(response.data); setOtpCode(""); setResendAt(Date.now() + response.data.resendIn * 1000); })}>{t("Resend code", "कोड दोबारा भेजें")}</button></form>}
      {step === "review" && quote && <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">{quote.lines.map((line, index) => <div key={index} className="flex justify-between gap-3 text-sm"><span>{line.qty} × {line.name}</span><span>{money(line.linePaise)}</span></div>)}<div className="space-y-2 border-t border-line pt-3 text-sm"><div className="flex justify-between"><span>{t("Food", "खाना")}</span><span>{money(quote.subtotalPaise)}</span></div><div className="flex justify-between"><span>{t("Tax", "टैक्स")}</span><span>{money(quote.taxPaise)}</span></div><div className="flex justify-between"><span>{t("Delivery", "डिलीवरी")}</span><span>{money(quote.deliveryFeePaise)}</span></div><div className="flex justify-between text-lg font-bold"><span>{t("Total", "कुल")}</span><span>{money(quote.totalPaise)}</span></div></div><p className="text-sm text-muted">{name} · {phone}<br />{address.line}, {address.locality} · {address.pincode}</p><>{data?.outlet.policy.paymentMode === "manual_qr" && <div className="space-y-3 rounded-xl border border-line p-3"><p className="text-sm font-semibold">{t("Pay this exact amount to the restaurant before preparation.", "ऑर्डर तैयार होने से पहले रेस्टोरेंट को यह पूरी रकम भेजें।")} <strong>{money(quote.totalPaise)}</strong></p>{data.outlet.paymentQrUrl ? <Image src={data.outlet.paymentQrUrl} alt={t("Restaurant payment QR", "रेस्टोरेंट का पेमेंट QR")} width={220} height={220} unoptimized className="mx-auto rounded-lg bg-white p-2" /> : <p role="alert" className="text-sm text-red-700">{t("The restaurant payment QR is unavailable. Contact staff.", "रेस्टोरेंट का पेमेंट QR उपलब्ध नहीं है। स्टाफ से संपर्क करें।")}</p>}<label className="block space-y-2 text-sm font-semibold">{t("UPI transaction reference / UTR", "UPI ट्रांज़ैक्शन रेफरेंस / UTR")}<input required minLength={6} maxLength={40} autoComplete="off" className={control} value={manualReference} onChange={event => setManualReference(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="e.g. 612345678901" /></label><p className="text-xs text-muted">{t("Your order is sent to the kitchen only after restaurant staff verifies this payment.", "रेस्टोरेंट स्टाफ पेमेंट की पुष्टि के बाद ही ऑर्डर किचन में जाएगा।")}</p></div>}<p className="text-sm font-semibold">{data?.outlet.policy.paymentMode === "gateway" ? t("Pay securely to the restaurant before preparation; the order is sent to the kitchen after payment confirmation.", "तैयारी से पहले रेस्टोरेंट को सुरक्षित पेमेंट करें; पेमेंट की पुष्टि के बाद ऑर्डर किचन में जाएगा।") : data?.outlet.policy.paymentMode === "manual_qr" ? t("Do not submit unless the payment is complete in your UPI app.", "अपने UPI ऐप में पेमेंट पूरा होने के बाद ही रेफरेंस भेजें।") : t("Pay on delivery · No online payment required", "डिलीवरी पर भुगतान करें")}</p><button type="button" disabled={pending || (data?.outlet.policy.paymentMode === "manual_qr" && (manualReference.trim().length < 6 || !data.outlet.paymentQrUrl))} className={button} onClick={() => run(async () => { if (data?.outlet.policy.paymentMode === "gateway") { await payDelivery(); return; } if (data?.outlet.policy.paymentMode === "manual_qr") { const response = await claimManualQrDeliveryAction(outletCode, quote.totalPaise, manualReference); if (!response.ok) { setError(response.message); return; } await loadStatus(); return; } const response = await placeDeliveryAction(outletCode, quote.totalPaise); if (!response.ok) { setError(response.message); const refreshed = await quoteDeliveryAction(outletCode, cart, address.pincode); if (refreshed.ok) setQuote(refreshed.data); return; } await loadStatus(); })}>{pending ? t(data?.outlet.policy.paymentMode === "gateway" ? "Opening secure payment…" : data?.outlet.policy.paymentMode === "manual_qr" ? "Submitting reference…" : "Placing order…", data?.outlet.policy.paymentMode === "gateway" ? "सुरक्षित पेमेंट खोल रहे हैं…" : data?.outlet.policy.paymentMode === "manual_qr" ? "रेफरेंस भेज रहे हैं…" : "ऑर्डर कर रहे हैं…") : t(data?.outlet.policy.paymentMode === "gateway" ? "Pay securely · place order" : data?.outlet.policy.paymentMode === "manual_qr" ? "I’ve paid · send for verification" : "Place delivery order", data?.outlet.policy.paymentMode === "gateway" ? "सुरक्षित पेमेंट करें · ऑर्डर दें" : data?.outlet.policy.paymentMode === "manual_qr" ? "पेमेंट हो गया · पुष्टि के लिए भेजें" : "डिलीवरी ऑर्डर करें")}</button></></section>}
    </div>}
    </>}
  </main>;
}
