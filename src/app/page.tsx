import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown, ArrowRight, ArrowUpRight, BedDouble, BellRing, Bike, CalendarDays,
  Check, ChefHat, ChevronDown, CircleCheck, Clock3, LayoutDashboard,
  Menu, MessageCircle, Package, PartyPopper, QrCode, ShieldCheck, Smartphone,
  Sparkles, Split, Store, Users, Utensils,
} from "lucide-react";
import s from "./landing.module.css";

const publicOrigin = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  title: "Tableeqr · Restaurant & hotel management by Craftory Innovation",
  description: "Connect QR ordering, billing, kitchen, reservations, direct delivery and hotel room service with Tableeqr. A product by Craftory Innovation.",
  alternates: publicOrigin ? { canonical: publicOrigin } : undefined,
  openGraph: {
    title: "Every table. Every room. One Tableeqr.",
    description: "A more connected restaurant and hotel. A product by Craftory Innovation.",
    url: publicOrigin,
    type: "website",
  },
};

const DEMO = "/r/SRJ01/t/HhK8";
const CONTACT = "https://wa.me/916367828788?text=Hi%20Craftory%20Innovation%2C%20I%27d%20like%20a%20Tableeqr%20demo%20for%20my%20business.";
const cx = (...classes: string[]) => classes.filter(Boolean).join(" ");
const nav = [
  { href: "#experience", label: "Guest experience" },
  { href: "#solutions", label: "Solutions" },
  { href: "#why-tableeqr", label: "Why Tableeqr" },
];
const journey = [
  { image: "scan", number: "01", icon: QrCode, title: "A scan. A whole menu.", text: "Let guests explore dishes in English or Hindi, right from their phone. No app to install.", alt: "A guest opens a food menu beside a table QR stand" },
  { image: "order", number: "02", icon: Utensils, title: "Good food. Ordered together.", text: "Everyone chooses their favourites. Orders reach your team straight from the table.", alt: "Two guests choose dishes together from a phone menu" },
  { image: "service", number: "03", icon: BellRing, title: "A little help. A tap away.", text: "Water, assistance or the bill. Give guests a direct way to ask, and staff a clear next step.", alt: "A guest requests assistance as a waiter approaches with water" },
];
const controls = [
  { icon: LayoutDashboard, title: "See the day clearly", text: "Sales, items, staff activity and day-close reports in one place." },
  { icon: Package, title: "Stay on top of stock", text: "Inventory, recipes, purchases and low-stock alerts." },
  { icon: Split, title: "Make group bills simple", text: "Split by individual items, equally or with custom amounts." },
  { icon: ShieldCheck, title: "Give the right access", text: "Manage staff roles and permissions across your operation." },
  { icon: Store, title: "Bring outlets together", text: "Manage branches while keeping outlet operations organised." },
  { icon: Smartphone, title: "Keep your team connected", text: "Waiter tasks, service requests and kitchen updates at hand." },
];
const questions = [
  { question: "Can a cloud kitchen offer pickup and delivery?", answer: "Yes. Enable pickup, delivery or both for each outlet. Guests see only the services you offer. Pickup orders do not require a delivery address, and you can choose whether payment at pickup is allowed." },
  { question: "Will I see features my business does not use?", answer: "Your setup follows your business category, package and outlet settings. Floor and table tools belong to dine-in businesses; room tools belong to hotels. Our team helps configure the right services." },
  { question: "Do guests need to download an app?", answer: "No. Guests scan a table or room QR code and open the guest experience in their phone browser. The menu supports English and Hindi." },
  { question: "Can I use Tableeqr for a hotel as well as a restaurant?", answer: "Yes. Tableeqr includes room QR codes, food ordering, housekeeping and guest requests, reception, check-in, check-out and room service bills. It supports hotels with or without a restaurant." },
  { question: "Can guests reserve a table and preorder food?", answer: "Yes, when reservations are enabled for your outlet. Guests can choose their time and party size, share seating preferences and preorder dishes. Your team can manage waitlists and party enquiries." },
  { question: "How do I get Tableeqr set up for my business?", answer: "Message Craftory Innovation on WhatsApp. Our team configures your services, menu and staff access remotely and helps you get started. Use your own compatible phones, computers and printers; hardware is not supplied." },
];

function Brand() {
  return <Link href="/" className={s.brand} aria-label="Tableeqr by Craftory Innovation home">
    <span className={s.brandIcon}><QrCode size={26} strokeWidth={2.2} aria-hidden="true" /></span>
    <span><span className={s.wordmark}>Tablee<span>qr</span></span><span className={s.company}>A product by <strong>Craftory Innovation</strong></span></span>
  </Link>;
}

export default function Home() {
  return <div className={s.landing}>
    <a className={s.skipLink} href="#main-content">Skip to content</a>
    <header className={s.header}>
      <div className={cx(s.container, s.headerInner)}>
        <Brand />
        <nav className={s.desktopNav} aria-label="Main navigation">{nav.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>
        <div className={s.headerActions}>
          <Link href="/console/login" className={s.signIn}>Sign in <ArrowUpRight size={15} aria-hidden="true" /></Link>
          <a href={CONTACT} target="_blank" rel="noopener noreferrer" className={cx(s.button, s.primary, s.headerDemo)}>Book a demo <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
        <details className={s.mobileMenu}>
          <summary aria-label="Open navigation"><Menu size={22} aria-hidden="true" /><span>Menu</span></summary>
          <nav aria-label="Mobile navigation">{nav.map(item => <a key={item.href} href={item.href}>{item.label}<ArrowRight size={16} aria-hidden="true" /></a>)}<Link href="/console/login">Sign in <ArrowUpRight size={16} aria-hidden="true" /></Link><a href={CONTACT} target="_blank" rel="noopener noreferrer">Book a demo <ArrowUpRight size={16} aria-hidden="true" /></a></nav>
        </details>
      </div>
    </header>

    <main id="main-content">
      <section className={cx(s.container, s.hero)} aria-labelledby="hero-heading">
        <div className={s.heroCopy}>
          <p className={s.eyebrow}><span /> RESTAURANTS · CAFÉS · HOTELS · CLOUD KITCHENS</p>
          <h1 id="hero-heading">Every table.<br />Every room.<br /><span>One Tableeqr.</span></h1>
          <p className={s.heroDescription}>Orders, kitchen, billing and guest service in one place. A setup that fits your restaurant, café, hotel or cloud kitchen.</p>
          <div className={s.heroActions}>
            <a href={CONTACT} target="_blank" rel="noopener noreferrer" className={cx(s.button, s.primary)}>Let’s talk about your business <ArrowUpRight size={18} aria-hidden="true" /></a>
            <Link href={DEMO} className={cx(s.button, s.secondary)}>Try the guest demo <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <div className={s.heroNotes}><span><Check size={15} aria-hidden="true" /> No guest app needed</span><span><Check size={15} aria-hidden="true" /> English & Hindi</span></div>
        </div>
        <div className={s.heroVisual}>
          <div className={s.heroOrbit} aria-hidden="true" />
          <Image src="/marketing/founder.webp" alt="Tableeqr presented on a phone with a food menu, photographs and ordering options" width={1122} height={1402} sizes="(max-width: 700px) 90vw, (max-width: 1100px) 48vw, 530px" preload className={s.heroImage} />
          <div className={cx(s.floatingChip, s.chipKitchen)}><span className={s.blueIcon}><ChefHat size={23} aria-hidden="true" /></span><div><b>Kitchen, connected.</b><small>From order to service</small></div></div>
          <div className={cx(s.floatingChip, s.chipHotel)}><span className={s.pinkIcon}><BedDouble size={23} aria-hidden="true" /></span><div><b>Beyond the table.</b><small>Room service, too.</small></div></div>
          <div className={s.heroCaption}><span><CircleCheck size={17} aria-hidden="true" /> YOUR SERVICE, IN SYNC</span><span>01 / THE TABLEEQR EXPERIENCE</span></div>
        </div>
      </section>

      <div className={s.capabilityBand}><div className={cx(s.container, s.capabilities)}>
        <p>One platform.<br /><strong>A lot less juggling.</strong></p>
        {[{ icon: QrCode, text: "QR ordering" }, { icon: ChefHat, text: "Kitchen & POS" }, { icon: CalendarDays, text: "Reservations" }, { icon: Bike, text: "Direct delivery" }, { icon: BedDouble, text: "Hotel rooms" }].map(item => <span key={item.text}><item.icon size={22} aria-hidden="true" />{item.text}</span>)}
      </div></div>

      <section id="experience" className={cx(s.container, s.section)} aria-labelledby="experience-heading">
        <div className={s.sectionTop}><div><p className={s.eyebrow}>A BETTER GUEST EXPERIENCE</p><h2 id="experience-heading">Less waiting.<br /><span>More enjoying.</span></h2></div><p>From choosing a favourite dish to asking for water, make the little moments of service feel easy.</p></div>
        <div className={s.journeyGrid}>{journey.map(item => <article key={item.number} className={s.journeyCard}>
          <div className={s.journeyImage}><Image src={"/marketing/" + item.image + ".webp"} alt={item.alt} fill sizes="(max-width: 700px) 90vw, (max-width: 1000px) 45vw, 370px" /><span className={s.stepNumber}>{item.number}</span><span className={s.journeyIcon}><item.icon size={23} aria-hidden="true" /></span></div>
          <h3>{item.title}</h3><p>{item.text}</p>
        </article>)}</div>
        <Link href={DEMO} className={s.textLink}>Take a look around the guest experience <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>

      <section id="solutions" className={s.solutionsSection} aria-labelledby="solutions-heading"><div className={s.container}>
        <div className={s.sectionTop}><div><p className={s.eyebrow}>BUILT AROUND YOUR BUSINESS</p><h2 id="solutions-heading">Your floor. Your rooms.<br /><span>Your kind of service.</span></h2></div><p>A café, a busy restaurant or a hotel with room service. Keep the workflows you need connected.</p></div>
        <div className={s.solutionGrid}>
          <article className={s.restaurantCard}>
            <span className={s.solutionLabel}><Utensils size={15} aria-hidden="true" /> RESTAURANTS & CAFÉS</span>
            <h3>A calmer floor.<br />A connected kitchen.</h3><p>Bring live tables, waiter tasks, kitchen tickets and POS billing into the same service flow.</p>
            <div className={s.restaurantImage}><Image src="/marketing/restaurant-operations.webp" alt="A restaurant manager checks orders on a tablet while the kitchen and service team work in the background" fill sizes="(max-width: 700px) 90vw, (max-width: 1100px) 45vw, 560px" /></div>
            <div className={s.solutionFootnote}><Check size={15} aria-hidden="true" /> Keep your people and orders in sync.</div>
          </article>
          <article className={s.hotelCard}>
            <Image src="/marketing/hotel.webp" alt="A hotel guest uses room services on a phone in a comfortable hotel room" fill sizes="(max-width: 800px) 90vw, 570px" />
            <div className={s.hotelOverlay}><span className={s.solutionLabel}><BedDouble size={15} aria-hidden="true" /> HOTELS & ROOM SERVICE</span><h3>A better stay.<br />Room by room.</h3><p>One room QR for food, housekeeping and assistance. Reception stays in control.</p><div className={s.hotelTags}><span>Room QR</span><span>Guest requests</span><span>Check-in & out</span></div></div>
          </article>
          <article className={s.compactSolution}>
            <div className={s.compactImage}><Image src="/marketing/reservation.webp" alt="A guest reserves a table and preorders food on a phone" fill sizes="(max-width: 700px) 90vw, 290px" /></div>
            <div><span className={s.miniEyebrow}><CalendarDays size={15} aria-hidden="true" /> BEFORE THEY ARRIVE</span><h3>Save a table.<br />Start the occasion.</h3><p>Reservations, food preorders, waitlists and party enquiries, organised.</p><span className={s.miniDetail}><PartyPopper size={15} aria-hidden="true" /> A dinner for two or a celebration.</span></div>
          </article>
          <article className={s.compactSolution}>
            <div className={s.compactImage}><Image src="/marketing/delivery.webp" alt="A restaurant delivery rider hands a food order to a customer at home" fill sizes="(max-width: 700px) 90vw, 290px" /></div>
            <div><span className={s.miniEyebrow}><Bike size={15} aria-hidden="true" /> BEYOND YOUR TABLES</span><h3>Your kitchen.<br />Their doorstep.</h3><p>Take direct orders, set delivery areas and charges, and assign riders.</p><span className={s.miniDetail}><Package size={15} aria-hidden="true" /> Keep customers updated.</span></div>
          </article>
        </div>
      </div></section>

      <section id="why-tableeqr" className={cx(s.container, s.section)} aria-labelledby="control-heading">
        <div className={s.sectionTop}><div><p className={s.eyebrow}>FOR THE PEOPLE RUNNING IT ALL</p><h2 id="control-heading">A clear view.<br /><span>A little more control.</span></h2></div><p>Behind every good guest experience is a team with the right information. Give yours a place to find it.</p></div>
        <div className={s.controlsGrid}>{controls.map(item => <article key={item.title}><span className={s.controlIcon}><item.icon size={23} aria-hidden="true" /></span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
        <div className={s.controlStrip}><span><Clock3 size={21} aria-hidden="true" /> From the first order to day close.</span><span><Users size={21} aria-hidden="true" /> Guests. Staff. Kitchen. Owner.</span><span><CircleCheck size={21} aria-hidden="true" /> One connected Tableeqr.</span></div>
      </section>

      <section className={cx(s.container, s.faqSection)} aria-labelledby="faq-heading">
        <div><p className={s.eyebrow}>A FEW THINGS YOU MIGHT ASK</p><h2 id="faq-heading">Let’s make<br /><span>things clear.</span></h2><a href={CONTACT} target="_blank" rel="noopener noreferrer" className={s.textLink}>Ask us on WhatsApp <ArrowUpRight size={17} aria-hidden="true" /></a></div>
        <div className={s.faqList}>{questions.map(item => <details key={item.question}><summary>{item.question}<ChevronDown size={20} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </section>

      <section className={cx(s.container, s.ctaSection)} aria-labelledby="cta-heading">
        <div className={s.cta}><div><p className={s.ctaEyebrow}><Sparkles size={16} aria-hidden="true" /> YOUR NEXT CHAPTER OF HOSPITALITY</p><h2 id="cta-heading">Good service starts here.<br />Let’s build your setup.</h2><p>Tell us about your business. We’ll show you Tableeqr.</p><div className={s.ctaActions}><a href={CONTACT} target="_blank" rel="noopener noreferrer" className={cx(s.button, s.whiteButton)}><MessageCircle size={18} aria-hidden="true" /> Book your demo <ArrowUpRight size={17} aria-hidden="true" /></a><a href="tel:+916367828788" className={s.callLink}>+91 63678 28788 <ArrowUpRight size={15} aria-hidden="true" /></a></div></div><div className={s.ctaSymbol} aria-hidden="true"><QrCode size={170} strokeWidth={1} /></div></div>
      </section>
    </main>

    <footer className={s.footer}>
      <div className={cx(s.container, s.footerTop)}>
        <div><Brand /><p>Better connected. Better hospitality.</p></div>
        <nav aria-label="Staff access"><span>YOUR WORKSPACE</span><Link href="/console/login">Restaurant sign in <ArrowUpRight size={13} aria-hidden="true" /></Link><Link href="/kds">Kitchen display <ArrowUpRight size={13} aria-hidden="true" /></Link><Link href="/waiter">Waiter app <ArrowUpRight size={13} aria-hidden="true" /></Link></nav>
        <nav aria-label="Contact"><span>LET’S TALK</span><a href={CONTACT} target="_blank" rel="noopener noreferrer">WhatsApp us <ArrowUpRight size={13} aria-hidden="true" /></a><a href="tel:+916367828788">+91 63678 28788</a><a href="#experience">Explore Tableeqr <ArrowDown size={13} aria-hidden="true" /></a></nav>
      </div>
      <div className={cx(s.container, s.footerBottom)}><span>© {new Date().getFullYear()} Craftory Innovation. Tableeqr is a Craftory Innovation product.</span><span>Beta · Early access <span aria-hidden="true">/</span> Illustrative product visuals</span></div>
    </footer>
  </div>;
}
