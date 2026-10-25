import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrinterSettings } from "@/app/(console)/console/(app)/settings/_components/printer-settings";
import { PrintToaster } from "@/components/print/print-toaster";
import { PrintManager, type PrintRequest, type SetupData } from "@/lib/print/manager";
import { getTransport, type PrintTransport } from "@/lib/print/transports";
import type { JobRow } from "@/server/print/jobs";
import type { PrintSetup } from "@/server/print/printers";

// The printer settings card and the print status toast, rendered to HTML.

vi.mock("@/app/(console)/console/(app)/settings/actions", () => ({ savePrinterAction: vi.fn(), removePrinterAction: vi.fn(), assignPrintersAction: vi.fn(), recentPrintsAction: vi.fn() }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const setup = (over: Partial<PrintSetup> = {}): PrintSetup => ({
  outletId: ID(9),
  printers: [{ id: ID(1), name: "Counter printer", paperMm: 80, transport: "browser", config: null }, { id: ID(2), name: "Kitchen printer", paperMm: 58, transport: "browser", config: null }],
  receiptPrinterId: ID(1), kitchenPrinterId: ID(2), ...over,
});
const job = (over: Partial<JobRow> = {}): JobRow => ({ id: "j1", kind: "bill", status: "sent", printerName: "Counter printer", transport: "browser", paperMm: 80, attempts: 1, reprint: false, failure: null, at: Date.UTC(2026, 9, 25, 9, 0), ...over });
const render = (initial: PrintSetup, recent: JobRow[] = []) => renderToStaticMarkup(createElement(PrinterSettings, { initial, outletId: ID(9), outletName: "Spice Route", recent }));

describe("printer settings card", () => {
  it("explains an empty outlet and still offers to add a printer", () => {
    const html = render(setup({ printers: [], receiptPrinterId: null, kitchenPrinterId: null }));
    expect(html).toContain("No printer added yet");
    expect(html).toContain("Add a printer");
    expect(html).not.toContain("This outlet uses");
  });

  it("lists printers with their roll, connection and which job each has", () => {
    const html = render(setup());
    expect(html).toContain("Counter printer");
    expect(html).toContain("80 mm roll · Browser print");
    expect(html).toContain("58 mm roll · Browser print");
    expect(html).toContain("Receipt printer</span>");
    expect(html).toContain("Kitchen printer</span>");
    expect(html).toContain("Test print");
    expect(html).toContain("This outlet uses");
    expect(html).toContain("This device only");
  });

  it("shows the recent prints with an honest result, and never calls a sent slip printed", () => {
    const html = render(setup(), [job(), job({ id: "j2", kind: "kot", status: "failed", failure: "Window blocked", attempts: 2 }), job({ id: "j3", kind: "receipt", reprint: true })]);
    expect(html).toContain("Bill");
    expect(html).toContain("Kitchen ticket");
    expect(html).toContain(">Sent<");
    expect(html).toContain(">Failed<");
    expect(html).toContain("2 tries");
    expect(html).toContain("again");
    expect(html).not.toContain(">Printed<");
    expect(html).toContain("A browser cannot tell whether paper came out");
    expect(html).toContain("Headers and footers off");
  });
});

function rig(send: PrintTransport["send"]) {
  const manager = new PrintManager({
    prefs: () => ({ receiptPrinterId: null, kitchenPrinterId: null }), paperSaved: () => 80, report: async () => null,
    transport: (id) => (id === "browser" ? ({ ...getTransport("browser"), availability: () => ({ ok: true as const }), send } as PrintTransport) : getTransport(id)),
  });
  const data: SetupData = { outletId: ID(9), printers: [], receiptPrinterId: null, kitchenPrinterId: null };
  manager.setSetup(data);
  return manager;
}
const req: PrintRequest = { kind: "bill", subject: { type: "session", id: "s1" }, build: () => "x" };
const toast = (m: PrintManager) => renderToStaticMarkup(createElement(PrintToaster, { manager: m }));

describe("print status toast", () => {
  it("shows nothing before anything is printed", () => {
    expect(toast(rig(async () => ({ status: "sent" })))).toBe("");
  });

  it("says a handed-over slip was sent, that nobody can confirm paper, and offers to print again", async () => {
    const m = rig(async () => ({ status: "sent" }));
    await m.print(req);
    const html = toast(m);
    expect(html).toContain("Sent to print");
    expect(html).toContain("cannot confirm that paper came out");
    expect(html).toContain("Print again");
    expect(html).not.toContain(">Printed<");
    expect(html).toContain('role="status"');
  });

  it("says plainly when it failed and offers to try again", async () => {
    const m = rig(async () => ({ status: "failed", code: "browser_print_failed", message: "The window was blocked.", retryable: true }));
    await m.print(req);
    const html = toast(m);
    expect(html).toContain("Could not print");
    expect(html).toContain("The window was blocked.");
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Print again");
  });

  it("stays out of the way for a kitchen ticket printing itself, unless it fails", async () => {
    const ok = rig(async () => ({ status: "sent" }));
    await ok.print({ ...req, kind: "kot", background: true });
    expect(toast(ok)).toBe("");
    const bad = rig(async () => ({ status: "failed", code: "browser_print_failed", message: "No printer.", retryable: true }));
    await bad.print({ ...req, kind: "kot", background: true });
    expect(toast(bad)).toContain("Could not print");
  });

  it("is hidden from the printed page itself", async () => {
    const m = rig(async () => ({ status: "sent" }));
    await m.print(req);
    expect(toast(m)).toContain("print:hidden");
  });
});
