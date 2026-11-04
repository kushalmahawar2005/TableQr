import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChefHat, QrCode, Smartphone, Store, Utensils } from "lucide-react";
import { DEMO_CONTACT, DEMO_SURFACES, LIVE_GUEST_DEMO } from "./demo-content";
import styles from "./demo.module.css";

const publicOrigin = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  title: "Tableeqr product demo",
  description: "Explore Tableeqr previews for owners, cashiers, kitchen teams, waiters and riders, then try the live guest QR demo.",
  robots: { index: false, follow: false },
  alternates: publicOrigin ? { canonical: `${publicOrigin.replace(/\/$/, "")}/demo` } : undefined,
};

const liveRoles = [
  { icon: Store, label: "Owner and manager", text: "One view for the day" },
  { icon: Utensils, label: "Cashier and POS", text: "Fast order and billing" },
  { icon: ChefHat, label: "Kitchen team", text: "Clear ticket flow" },
  { icon: Smartphone, label: "Waiter and rider", text: "Mobile service tools" },
];

export default function DemoPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Tableeqr home">
          <span className={styles.brandIcon}><QrCode size={22} aria-hidden="true" /></span>
          <span>Tablee<span className={styles.brandAccent}>qr</span></span>
        </Link>
        <Link href="/" className={styles.headerLink}>Back to Tableeqr <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>TABLEEQR · PRODUCT WALKTHROUGH</p>
        <h1>Take a look around.<br /><span>Choose your role.</span></h1>
        <p className={styles.heroText}>Short previews for the people who run service. Open a role to see its screen, or try the live guest ordering experience on your phone.</p>
        <div className={styles.heroActions}>
          <Link href={LIVE_GUEST_DEMO} className={styles.primaryButton}>Open live guest demo <ArrowRight size={17} aria-hidden="true" /></Link>
          <a href={DEMO_CONTACT} target="_blank" rel="noopener noreferrer" className={styles.secondaryButton}>Arrange a walkthrough <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
        <div className={styles.roleStrip}>
          {liveRoles.map(({ icon: Icon, label, text }) => <div className={styles.roleFact} key={label}><Icon size={18} aria-hidden="true" /><span><b>{label}</b><small>{text}</small></span></div>)}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="roles-heading">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>PREVIEW THE WORKFLOW</p><h2 id="roles-heading">Pick a team view</h2></div><p>These role previews use sample screens. No sign-in or real restaurant data is needed.</p></div>
        <div className={styles.cardGrid}>
          {DEMO_SURFACES.map((surface, index) => <Link className={styles.demoCard} href={`/demo/${surface.slug}`} key={surface.slug}>
            <div className={`${styles.imageFrame} ${surface.shape === "phone" ? styles.phoneFrame : ""}`}>
              <Image src={surface.image} alt={surface.alt} fill sizes="(max-width: 680px) 90vw, (max-width: 1050px) 44vw, 30vw" className={surface.shape === "phone" ? styles.phoneImage : styles.wideImage} preload={index < 2} />
              <span className={styles.cardNumber}>0{index + 1}</span>
            </div>
            <div className={styles.cardCopy}><div><h3>{surface.title}</h3><p>{surface.description}</p></div><span className={styles.roundArrow}><ArrowRight size={17} aria-hidden="true" /></span></div>
          </Link>)}
        </div>
      </section>

      <section className={styles.guestCard}>
        <div className={styles.guestCopy}><p className={styles.eyebrow}>GUEST QR · LIVE DEMO</p><h2>Scan, browse and order.</h2><p>Try the real mobile guest flow without downloading an app. The demo opens with a sample restaurant and table.</p><Link href={LIVE_GUEST_DEMO} className={styles.primaryButton}>Try the guest link <ArrowRight size={17} aria-hidden="true" /></Link></div>
        <Link href={LIVE_GUEST_DEMO} className={styles.guestImage} aria-label="Open the live guest demo"><Image src="/demo/guest-menu.png" alt="Preview of the Tableeqr guest menu on a phone" fill sizes="(max-width: 760px) 80vw, 320px" /></Link>
      </section>

      <footer className={styles.footer}><span>Tableeqr · A product by Craftory Innovation</span><a href={DEMO_CONTACT} target="_blank" rel="noopener noreferrer">Talk about your setup <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
    </main>
  );
}
