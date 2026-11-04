import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, QrCode } from "lucide-react";
import { DEMO_CONTACT, DEMO_SURFACES } from "../demo-content";
import styles from "../demo.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return DEMO_SURFACES.map(({ slug }) => ({ role: slug }));
}

type DemoRoleProps = { params: Promise<{ role: string }> };

export async function generateMetadata(props: DemoRoleProps): Promise<Metadata> {
  const { role } = await props.params;
  const surface = DEMO_SURFACES.find((item) => item.slug === role);
  return surface ? {
    title: `${surface.title} demo · Tableeqr`,
    description: surface.description,
    robots: { index: false, follow: false },
  } : { title: "Demo not found · Tableeqr", robots: { index: false, follow: false } };
}

export default async function DemoRolePage(props: DemoRoleProps) {
  const { role } = await props.params;
  const index = DEMO_SURFACES.findIndex((item) => item.slug === role);
  if (index < 0) notFound();
  const surface = DEMO_SURFACES[index];
  const next = DEMO_SURFACES[(index + 1) % DEMO_SURFACES.length];

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/demo" className={styles.brand} aria-label="All Tableeqr demos"><span className={styles.brandIcon}><QrCode size={22} aria-hidden="true" /></span><span>Tablee<span className={styles.brandAccent}>qr</span></span></Link>
      <Link href="/demo" className={styles.headerLink}><ArrowLeft size={15} aria-hidden="true" /> All demo views</Link>
    </header>

    <section className={styles.previewHero}>
      <div className={styles.previewCopy}>
        <p className={styles.eyebrow}>ROLE PREVIEW · SAMPLE SCREEN</p>
        <h1>{surface.title}<br /><span>{surface.shortTitle}</span></h1>
        <p className={styles.heroText}>{surface.description} This visual preview uses example restaurant information. It does not sign in to or change a live account.</p>
        <div className={styles.heroActions}>
          <Link href={`/demo/${next.slug}`} className={styles.primaryButton}>Next: {next.title} <ArrowRight size={17} aria-hidden="true" /></Link>
          <a href={DEMO_CONTACT} target="_blank" rel="noopener noreferrer" className={styles.secondaryButton}>Request a live walkthrough <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
      </div>
      <div className={`${styles.previewImage} ${surface.shape === "phone" ? styles.previewPhone : ""}`}>
        <Image src={surface.image} alt={surface.alt} fill sizes="(max-width: 850px) 94vw, 70vw" preload className={surface.shape === "phone" ? styles.phoneImage : styles.wideImage} />
      </div>
    </section>
    <footer className={styles.footer}><Link href="/demo"><ArrowLeft size={14} aria-hidden="true" /> Back to all previews</Link><span>Tableeqr · A product by Craftory Innovation</span></footer>
  </main>;
}
