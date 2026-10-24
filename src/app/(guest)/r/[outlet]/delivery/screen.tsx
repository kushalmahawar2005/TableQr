"use client";
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
const control = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-ink";
const button = "min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-brand-on disabled:opacity-50";

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
  const visibleItems = data?.items.filter(item => `${item.name} ${item.nameHi ?? ""} ${item.description ?? ""} ${item.descriptionHi ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const visibleIds = new Set(visibleItems.map(item => item.id));
  const visibleCategories = data?.categories.map(category => ({
    id: category.id,
    label: hindi ? category.nameHi || category.nameEn : category.nameEn,
    photo: category.imageUrl ?? category.items.find(item => item.imageUrl)?.imageUrl ?? null,
    items: category.items.filter(item => visibleIds.has(item.id)),
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
  return <main lang={hindi ? "hi" : "en"} className="mx-auto w-full max-w-2xl px-4 py-5 pb-[calc(7rem+env(safe-area-inset-bottom))] text-ink sm:px-6 sm:py-8">
    <header className="flex items-center justify-between gap-3"><Link href={`/r/${encodeURIComponent(outletCode)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm">← {t("Restaurant", "रेस्टोरेंट")}</Link><button type="button" onClick={() => setHindi(value => !value)} className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-semibold">{hindi ? "English" : "हिन्दी"}</button></header>
    {data && <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm"><OutletLogo name={data.outlet.name} logoUrl={data.outlet.logoUrl} size={44} /><div className="min-w-0 flex-1"><p className="truncate font-bold">{data.outlet.name}</p><p className="text-sm text-muted">{t("Home delivery", "घर पर डिलीवरी")}</p></div><span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong">{data.outlet.policy.estimatedMinutes} min</span></div>}
    {error && <p role="alert" className="my-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
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
      <section className="mt-6 overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="relative bg-brand-soft px-5 py-6 sm:px-7">
          <p className="text-xs font-bold uppercase tracking-[.14em] text-brand-strong">{t("Home delivery", "घर पर डिलीवरी")}</p>
          <h1 className="mt-2 font-display text-3xl font-bold">{t("Order your favourites", "अपनी पसंद का खाना ऑर्डर करें")}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{t(`Freshly prepared · about ${data.outlet.policy.estimatedMinutes} minutes. ${data.outlet.policy.paymentMode === "gateway" ? "Pay securely before preparation." : data.outlet.policy.paymentMode === "manual_qr" ? "Pay using the restaurant QR." : "Pay when your order arrives."}`, `ताज़ा तैयार · लगभग ${data.outlet.policy.estimatedMinutes} मिनट। ${data.outlet.policy.paymentMode === "gateway" ? "तैयारी से पहले सुरक्षित पेमेंट करें।" : data.outlet.policy.paymentMode === "manual_qr" ? "रेस्टोरेंट QR से पेमेंट करें।" : "ऑर्डर मिलने पर भुगतान करें।"}`)}</p>
        </div>
        <div className="p-4 sm:px-6">
          <label className="block">
            <span className="sr-only">{t("Search menu", "मेन्यू में खोजें")}</span>
            <input aria-label="Search menu" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Search dishes…", "डिश खोजें…")} className={`${control} rounded-2xl bg-paper`} />
          </label>
        </div>
      </section>
      {visibleCategories.length > 0 && <CategoryBar categories={visibleCategories.map(({ id, label, photo }) => ({ id, label, photo }))} label={t("Menu categories", "मेन्यू कैटेगरी")} />}
      <div className="mt-4 space-y-7">
        {visibleCategories.map(category => <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-36">
          <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold">{category.label}</h2><p className="mt-0.5 text-xs text-muted">{t(`${category.items.length} dishes`, `${category.items.length} डिश`)}</p></div></div>
          <ul className="m-0 list-none p-0">
            {category.items.map(item => {
              const qty = itemQty(item.id);
              const available = item.available;
              const itemName = hindi ? item.nameHi || item.name : item.name;
              return <li key={item.id} className={`mb-3 flex gap-3 rounded-2xl border border-line/80 bg-surface p-3 shadow-[0_1px_3px_rgb(0_0_0/0.05)] ${!available ? "opacity-65" : ""}`}>
                <Thumb photo={item.imageUrl} soldOut={!available} size="size-[88px]" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1.5"><VegMark veg={item.isVeg} label={item.isVeg ? t("Vegetarian", "शाकाहारी") : t("Non-vegetarian", "मांसाहारी")} />{item.isJain && <span className="rounded border border-line px-1 text-[10px] font-semibold text-muted">Jain</span>}</div>
                  <h3 className="mt-1.5 text-sm font-bold text-ink">{itemName}</h3>
                  <p className={`mt-0.5 text-sm font-semibold tabular ${available ? "text-ink" : "text-muted"}`}>{money(item.pricing.pricePaise)}</p>
                  {(hindi ? item.descriptionHi || item.description : item.description) && <p className="mt-1 line-clamp-2 text-xs text-muted">{hindi ? item.descriptionHi || item.description : item.description}</p>}
                  {item.pricing.groups.length > 0 && <p className="mt-1 text-xs text-muted">{t("Customise this dish", "अपनी पसंद के विकल्प चुनें")}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end justify-end">
                  {!qty ? <button type="button" disabled={!available} onClick={() => { if (item.pricing.groups.length) { setSelected(item); setChoices([]); } else add(item, []); }} className="min-h-10 min-w-[72px] rounded-xl border border-brand bg-surface px-3 text-sm font-bold text-brand-strong shadow-sm disabled:cursor-not-allowed disabled:opacity-50">{available ? t("Add +", "+ जोड़ें") : t("Sold out", "खत्म")}</button> : <div className="flex min-h-10 items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-2"><button type="button" aria-label={t(`Remove ${itemName}`, `${itemName} हटाएँ`)} onClick={() => removeOne(item.id)} className="grid size-8 place-items-center rounded-lg text-lg font-bold text-brand-strong">−</button><span className="min-w-4 text-center text-sm font-bold tabular">{qty}</span><button type="button" disabled={!available} aria-label={t(`Add ${itemName}`, `${itemName} जोड़ें`)} onClick={() => item.pricing.groups.length ? (setSelected(item), setChoices([])) : add(item, [])} className="grid size-8 place-items-center rounded-lg text-lg font-bold text-brand-strong disabled:opacity-50">+</button></div>}
                </div>
              </li>;
            })}
          </ul>
        </section>)}
      </div>
      {data.items.length === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("No delivery dishes are available right now.", "अभी डिलीवरी के लिए कोई डिश उपलब्ध नहीं है।")}</p>}
      {data.items.length > 0 && visibleCategories.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("No dishes match your search.", "आपकी खोज से कोई डिश नहीं मिली।")}</p>}
      {cart.length > 0 && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur"><div className="mx-auto max-w-2xl"><button type="button" onClick={() => setStep("address")} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-left font-bold text-brand-on shadow-lg"><span>{t(`View cart · ${totalQty} ${totalQty === 1 ? "item" : "items"}`, `कार्ट देखें · ${totalQty} आइटम`)}</span><span>{t("Continue", "आगे बढ़ें")} →</span></button></div></div>}
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
