import { canSee } from "@/lib/staff-permissions";
import { AppError } from "@/server/errors";
import { getCustomers, type CustomerFilter } from "@/server/staff/customers";
import { currentStaff } from "@/server/staff/request";

const FILTERS: CustomerFilter[] = ["all", "regulars", "offers", "away"];
const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
const cell = (v: string | number) => {
  // A cell that starts like a formula would run in Excel; a leading apostrophe stops that
  const text = /^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : String(v);
  return `"${text.replace(/"/g, '""')}"`;
};

// Every customer matching the search and filter as a CSV (the screen shows 50 at a time)
export async function GET(request: Request) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "customers")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const filter = FILTERS.find((f) => f === url.searchParams.get("filter")) ?? "all";
  try {
    const { customers } = await getCustomers(staff, { q: (url.searchParams.get("q") ?? "").slice(0, 60), filter, all: true });
    const rows = [["Name", "Phone", "Came with", "Visits", "Last visit", "Bookings", "No-shows", "Spend (Rs)", "Offers OK"], ...customers.map((c) => {
      const { names, unnamed } = c.companions;
      const withText = names.length ? (unnamed ? `${names.join(", ")} and ${unnamed} more` : names.join(", ")) : unnamed ? `${unnamed} other${unnamed === 1 ? "" : "s"}` : "";
      return [c.name ?? "", c.phone, withText, c.visits, day(c.lastVisitAt), c.bookings, c.noShows, Math.round(c.spendPaise / 100), c.offersOk ? "yes" : "no"];
    })];
    return new Response(rows.map((r) => r.map(cell).join(",")).join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="customers.csv"', "Cache-Control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Could not export", { status: e instanceof AppError && e.code === "forbidden" ? 403 : 500 });
  }
}
