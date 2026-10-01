import Link from "next/link";

const surfaces = [
  { href: "/r/SRJ01/t/k7Qm", label: "Guest: table landing (G1)" },
  { href: "/r/SRJ01/book", label: "Guest: book a table (B1)" },
  { href: "/console/floor", label: "Staff: host floor (S1)" },
  { href: "/kds", label: "Kitchen display (S2)" },
  { href: "/waiter", label: "Waiter phone (S3)" },
  { href: "/admin", label: "Platform admin" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-5 py-12">
      <h1 className="font-display text-display font-bold">TableQR</h1>
      <p className="mt-2 text-muted">
        Development index. Every surface below is a placeholder until it is
        built.
      </p>
      <ul className="mt-8 divide-y divide-line rounded-card border border-line">
        {surfaces.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="block px-4 py-3 hover:bg-paper">
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
