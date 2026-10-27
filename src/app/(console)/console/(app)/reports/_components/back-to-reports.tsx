import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Every report page leads back to the Reports overview; hidden on paper */
export function BackToReports() {
  return (
    <Link href="/console/reports" className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg pr-2 text-caption font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand print:hidden">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Reports
    </Link>
  );
}
