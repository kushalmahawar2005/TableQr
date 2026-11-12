"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, ChefHat, CreditCard, QrCode, Utensils } from "lucide-react";
import s from "./service-story.module.css";

const steps = [
  { icon: QrCode, label: "Scan", title: "A guest sits down and scans.", text: "The table QR opens your menu in their phone browser, in English or Hindi. No app, no waiting for a card." },
  { icon: Utensils, label: "Order", title: "The table orders together.", text: "Everyone adds their own dishes from their own phone. One order, with every person's choices kept apart for the bill." },
  { icon: ChefHat, label: "Cook", title: "The kitchen sees it at once.", text: "A ticket appears on the kitchen display, sorted by station, with a timer so nothing waits too long." },
  { icon: BellRing, label: "Serve", title: "The waiter knows what is ready.", text: "When food is ready, the right waiter's phone buzzes. Water and help requests come the same way." },
  { icon: CreditCard, label: "Pay", title: "The bill splits itself.", text: "Guests see their share and pay by UPI or card, or settle at the table. Your day close adds up on its own." },
] as const;

/** Scroll-driven walk through one table's service: the phone stays in view while the story moves on */
export function ServiceStory() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const items = refs.current.filter((el): el is HTMLLIElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
      },
      // On phones the pinned phone covers the top of the screen, so read the step just below it
      { rootMargin: window.matchMedia("(max-width: 900px)").matches ? "-68% 0px -22% 0px" : "-45% 0px -45% 0px" },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how-it-works" className={s.story} aria-labelledby="story-heading">
      <div className={s.inner}>
        <div className={s.stage}>
          <div className={s.stageSticky}>
            <p className={s.eyebrow}>ONE TABLE, FROM START TO FINISH</p>
            <h2 id="story-heading">From scan{" "}<br /><span>to settled.</span></h2>
            <ol className={s.progress} aria-label="Story progress">
              {steps.map((step, i) => (
                <li key={step.label} className={i <= active ? s.progressOn : undefined} aria-current={i === active ? "step" : undefined}>
                  <step.icon size={16} aria-hidden="true" />
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
            <div className={s.phone} aria-hidden="true">
              <div className={s.notch} />
              <div className={s.screen}>
                <Screen index={0} active={active}><ScanScreen /></Screen>
                <Screen index={1} active={active}><OrderScreen /></Screen>
                <Screen index={2} active={active}><KitchenScreen /></Screen>
                <Screen index={3} active={active}><WaiterScreen /></Screen>
                <Screen index={4} active={active}><BillScreen /></Screen>
              </div>
            </div>
          </div>
        </div>

        <ol className={s.steps}>
          {steps.map((step, i) => (
            <li key={step.label} ref={(el) => { refs.current[i] = el; }} data-step={i} className={i === active ? s.stepActive : s.step}>
              <span className={s.stepIcon}><step.icon size={22} aria-hidden="true" /></span>
              <span className={s.stepNo}>0{i + 1} · {step.label.toUpperCase()}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Screen({ index, active, children }: { index: number; active: number; children: React.ReactNode }) {
  const state = index === active ? s.screenOn : index < active ? s.screenPast : s.screenNext;
  return <div className={`${s.screenPane} ${state}`}>{children}</div>;
}

function ScanScreen() {
  return <div className={s.scan}>
    <small>Spice Route · Table T4</small>
    <div className={s.qrBox}><QrCode size={92} strokeWidth={1.4} /><span className={s.scanLine} /></div>
    <b>Welcome! Choose your language</b>
    <div className={s.langRow}><span className={s.chipOn}>English</span><span>हिंदी</span></div>
  </div>;
}

function OrderScreen() {
  const items = [["Paneer Tikka", "₹320", "Aman"], ["Dal Makhani", "₹280", "Riya"], ["Butter Naan ×2", "₹140", "Aman"]] as const;
  return <div className={s.order}>
    <small>Table T4 · 3 guests</small>
    <ul>{items.map(([name, price, who], i) => <li key={name} style={{ animationDelay: `${150 + i * 140}ms` }}><span><b>{name}</b><em>{who}</em></span><span>{price}</span></li>)}</ul>
    <div className={s.cartBar}>Place order · ₹740</div>
  </div>;
}

function KitchenScreen() {
  return <div className={s.kitchen}>
    <small>Kitchen display</small>
    <div className={s.ticket}>
      <div className={s.ticketHead}><b>T4 · Round 1</b><span className={s.timer}>04:12</span></div>
      <ul><li>1× Paneer Tikka <em>Tandoor</em></li><li>1× Dal Makhani <em>Main</em></li><li>2× Butter Naan <em>Tandoor</em></li></ul>
      <div className={s.cooking}><span />Cooking</div>
    </div>
  </div>;
}

function WaiterScreen() {
  return <div className={s.waiter}>
    <small>Waiter · Rahul</small>
    <div className={s.alert}><BellRing size={18} /><span><b>T4 food is ready</b><em>3 dishes · Tandoor, Main</em></span></div>
    <div className={s.request}><span><b>T7 asks for water</b><em>just now</em></span></div>
    <div className={s.served}><Check size={16} /> Served</div>
  </div>;
}

function BillScreen() {
  return <div className={s.bill}>
    <small>Your bill · T4</small>
    <div className={s.total}><em>Total</em><b>₹777</b><span>incl. GST</span></div>
    <ul><li><span>Aman</span><span>₹483</span></li><li><span>Riya</span><span>₹294</span></li></ul>
    <div className={s.paid}><Check size={16} /> Paid by UPI</div>
  </div>;
}
