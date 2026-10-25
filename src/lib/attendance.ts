// The attendance register: what each mark is worth and how a month adds up. No database here.

export const STATUSES = ["present", "half_day", "absent", "leave", "week_off"] as const;
export type AttendanceStatus = (typeof STATUSES)[number];
export const isStatus = (v: unknown): v is AttendanceStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export const STATUS_LABEL: Record<AttendanceStatus, string> = { present: "Present", half_day: "Half day", absent: "Absent", leave: "Leave", week_off: "Week off" };
/** Days worked a mark counts for: a full day, half a day, or none. Leave and a week off are not worked days. */
export const dayValue = (s: AttendanceStatus) => (s === "present" ? 1 : s === "half_day" ? 0.5 : 0);

export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export const addDays = (date: string, days: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
export const addMonths = (month: string, n: number) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
/** Every date of a month, "2026-02" gives 28 or 29 dates */
export const datesOfMonth = (month: string) => {
  const out: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
};

export type MonthCounts = { present: number; half_day: number; absent: number; leave: number; week_off: number; unmarked: number; daysWorked: number };
/** One person's month from their marks; `days` is how many days to count (all of a past month, up to today for this one) */
export function monthCounts(marks: readonly { status: AttendanceStatus }[], days: number): MonthCounts {
  const c: MonthCounts = { present: 0, half_day: 0, absent: 0, leave: 0, week_off: 0, unmarked: 0, daysWorked: 0 };
  for (const m of marks) { c[m.status]++; c.daysWorked += dayValue(m.status); }
  c.unmarked = Math.max(0, days - marks.length);
  return c;
}

const csvCell = (v: string | number) => {
  // A cell that starts like a formula is made harmless for spreadsheets
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const csvRows = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
