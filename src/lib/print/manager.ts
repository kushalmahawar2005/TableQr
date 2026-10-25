import { describeJob, roleForKind, type JobStatus, type PrintKind } from "./jobs";
import { getTransport, type PrintTransport } from "./transports";
import type { PaperMm } from "./thermal";

// Sends a slip to the right printer and keeps an honest account of what happened. Everything a
// screen needs sits behind print(): which printer this device uses, which transport reaches it,
// protection against a double tap, a record on the server, and what to offer when it did not work.
// It has no React and no browser calls of its own, so it is tested like any other module.

export type PrinterRef = { id: string; name: string; paperMm: PaperMm; transport: string; config: Record<string, string | number | boolean> | null };
export type SetupData = { outletId: string; printers: PrinterRef[]; receiptPrinterId: string | null; kitchenPrinterId: string | null };
/** What this one device uses; null follows the outlet's choice */
export type DevicePrefs = { receiptPrinterId: string | null; kitchenPrinterId: string | null };

export type JobReport = {
  requestId: string;
  kind: string;
  printerId?: string | null;
  transport: string;
  paperMm: number;
  status: string;
  subject?: { type: string; id: string } | null;
  failureCode?: string | null;
  failureDetail?: string | null;
  reprintOf?: string | null;
};
export type JobResult = { jobId: string; status: JobStatus; attempts: number; duplicate: boolean };

export type PrintRequest = {
  kind: PrintKind;
  /** What is being printed (a table session, a ticket, a date). Two prints of the same thing in quick succession are one. */
  subject?: { type: string; id: string };
  /** Builds the slip for the roll width in use */
  build: (paperMm: PaperMm) => string;
  /** A print nobody is waiting at, such as a kitchen ticket printing itself */
  background?: boolean;
  /** Print again on purpose: a new job, linked to the last one */
  reprint?: boolean;
  /** Use this printer, whatever the settings say (a test print from the settings screen) */
  printerId?: string;
  /** Skip the printer's own way of printing and use the browser */
  forceBrowser?: boolean;
};

export type PrintRun = {
  key: string;
  requestId: string;
  kind: PrintKind;
  subject: { type: string; id: string } | null;
  printerId: string | null;
  printerName: string | null;
  transport: string;
  paperMm: PaperMm;
  status: JobStatus;
  confirmable: boolean;
  message: string;
  code: string | null;
  retryable: boolean;
  attempts: number;
  at: number;
  jobId: string | null;
  /** The printer's own transport was not usable, so the browser was used */
  usedFallback: boolean;
  /** Set when a print was not repeated because the same one had just gone out */
  duplicate: boolean;
  background: boolean;
};

export type ManagerState = { last: PrintRun | null; busy: boolean; unsent: number };

export type ManagerDeps = {
  /** Defaults to what setSetup() last gave */
  getSetup?(): SetupData | null;
  prefs(): DevicePrefs;
  paperSaved(): PaperMm;
  /** Tells the server what became of a print. May fail while offline: the manager keeps it and tries again. */
  report(report: JobReport): Promise<JobResult | null>;
  transport?(id: string): PrintTransport;
  now?(): number;
  uuid?(): string;
  /** Prints of the same thing closer together than this are one print */
  guardMs?: number;
  /** Somewhere to keep reports that could not be sent, so a reload does not lose them */
  storage?: { load(): JobReport[]; save(reports: JobReport[]): void };
};

const MAX_UNSENT = 50;

export class PrintManager {
  private state: ManagerState = { last: null, busy: false, unsent: 0 };
  private listeners = new Set<() => void>();
  private recent = new Map<string, { requestId: string; at: number }>();
  private unsent: JobReport[];
  private flushing = false;
  private lastHtml: string | null = null;
  private lastRequest: PrintRequest | null = null;
  private setupData: SetupData | null = null;
  private reporter: ManagerDeps["report"];

  constructor(private deps: ManagerDeps) {
    this.reporter = deps.report;
    this.unsent = deps.storage?.load() ?? [];
    this.state.unsent = this.unsent.length;
  }

  /** The outlet's printers, once loaded */
  setSetup(setup: SetupData | null) { this.setupData = setup; }
  /** How prints are reported to the server, which a screen may change as it re-renders */
  setReporter(report: ManagerDeps["report"]) { this.reporter = report; }

  private now = () => (this.deps.now ?? Date.now)();
  private uuid = () => (this.deps.uuid ?? (() => crypto.randomUUID()))();
  private transportFor = (id: string) => (this.deps.transport ?? getTransport)(id);

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<ManagerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** The printer a kind of slip goes to on this device: the device's own choice, else the outlet's, else none */
  resolvePrinter(kind: PrintKind, override?: string): PrinterRef | null {
    const setup = this.deps.getSetup ? this.deps.getSetup() : this.setupData;
    if (!setup) return null;
    if (override) return setup.printers.find((p) => p.id === override) ?? null;
    const prefs = this.deps.prefs();
    const kitchen = roleForKind(kind) === "kitchen";
    const own = kitchen ? prefs.kitchenPrinterId : prefs.receiptPrinterId;
    const outlet = kitchen ? setup.kitchenPrinterId : setup.receiptPrinterId;
    return setup.printers.find((p) => p.id === own) ?? setup.printers.find((p) => p.id === outlet) ?? null;
  }

  /** Prints a slip. Resolves once it has been handed over or has failed; never throws. */
  async print(req: PrintRequest): Promise<PrintRun> {
    const key = `${req.reprint ? "again:" : ""}${req.kind}:${req.subject ? `${req.subject.type}:${req.subject.id}` : ""}`;
    const seen = this.recent.get(key);
    const guardMs = this.deps.guardMs ?? 3000;
    if (seen && this.now() - seen.at < guardMs && this.state.last) {
      const twin = this.state.last.requestId === seen.requestId ? this.state.last : null;
      if (twin && twin.status !== "failed") {
        const dup = { ...twin, duplicate: true, message: "Already sent a moment ago. It was not printed twice." };
        this.set({ last: dup });
        return dup;
      }
    }
    const previous = req.reprint ? this.state.last : null;
    return this.run(req, this.uuid(), key, 1, previous?.jobId ?? null);
  }

  private async run(req: PrintRequest, requestId: string, key: string, attempts: number, reprintOf: string | null): Promise<PrintRun> {
    this.set({ busy: true });
    const printer = this.resolvePrinter(req.kind, req.printerId);
    let transport = this.transportFor(printer?.transport ?? "browser");
    let usedFallback = false;
    if (req.forceBrowser || !transport.implemented || !transport.availability().ok) {
      usedFallback = !!printer && printer.transport !== "browser";
      transport = this.transportFor("browser");
    }
    const paperMm = printer?.paperMm ?? this.deps.paperSaved();
    const base: PrintRun = {
      key, requestId, kind: req.kind, subject: req.subject ?? null, printerId: printer?.id ?? null, printerName: printer?.name ?? null, transport: transport.id, paperMm,
      status: "queued", confirmable: transport.capabilities.confirmation === "printer", message: "", code: null, retryable: false, attempts, at: this.now(), jobId: null, usedFallback, duplicate: false, background: !!req.background,
    };
    this.recent.set(key, { requestId, at: this.now() });
    this.lastRequest = req;
    this.set({ last: { ...base, message: describeJob("queued", { confirmable: base.confirmable, printerName: base.printerName }) } });

    let result: Awaited<ReturnType<PrintTransport["send"]>>;
    try {
      const html = req.build(paperMm);
      this.lastHtml = html;
      result = await transport.send({ id: requestId, kind: req.kind, paperMm, html, printerName: printer?.name ?? null, config: printer?.config ?? null, background: !!req.background });
    } catch (err) {
      result = { status: "failed", code: "build_failed", message: err instanceof Error ? err.message : "The slip could not be prepared.", retryable: false };
    }
    // A transport may only say "confirmed" if it can ever confirm
    if (result.status === "confirmed" && !base.confirmable) result = { status: "sent" };
    const run: PrintRun = result.status === "failed"
      ? { ...base, status: "failed", code: result.code, retryable: result.retryable, message: describeJob("failed", { confirmable: base.confirmable, printerName: base.printerName, detail: result.message }) }
      : { ...base, status: result.status, message: describeJob(result.status, { confirmable: base.confirmable, printerName: base.printerName }) };
    this.set({ last: run, busy: false });
    void this.enqueue({
      requestId, kind: req.kind, printerId: run.printerId, transport: run.transport, paperMm, status: run.status, subject: run.subject,
      failureCode: run.code, failureDetail: result.status === "failed" ? result.message : null, reprintOf,
    });
    return run;
  }

  /** Try the last print again, same job, when it failed in a way worth trying again */
  async retry(): Promise<PrintRun | null> {
    const last = this.state.last;
    if (!last || last.status !== "failed" || !this.lastRequest) return null;
    return this.run(this.lastRequest, last.requestId, last.key, last.attempts + 1, null);
  }

  /** Print the last slip again on purpose: a new job, linked to the last one, with the data as it is now */
  async printAgain(): Promise<PrintRun | null> {
    if (!this.lastRequest || !this.state.last) return null;
    return this.print({ ...this.lastRequest, reprint: true });
  }

  /** The printer's own way did not work: print the last slip through the browser instead, as a new job */
  async useBrowser(): Promise<PrintRun | null> {
    if (!this.lastRequest || !this.state.last) return null;
    return this.print({ ...this.lastRequest, forceBrowser: true, reprint: true, background: false });
  }

  dismiss() { this.set({ last: null }); }

  private async enqueue(report: JobReport) {
    this.unsent.push(report);
    if (this.unsent.length > MAX_UNSENT) this.unsent.splice(0, this.unsent.length - MAX_UNSENT);
    this.persist();
    await this.flush();
  }

  /** Sends the reports waiting, oldest first, stopping at the first that cannot go (offline) */
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.unsent.length) {
        const next = this.unsent[0];
        try {
          const res = await this.reporter(next);
          this.unsent.shift();
          const last = this.state.last;
          if (res && last && last.requestId === next.requestId) this.set({ last: { ...last, jobId: res.jobId, attempts: res.attempts } });
        } catch (err) {
          // A refusal is final; only a network failure is worth keeping to try again
          if (isRefusal(err)) { this.unsent.shift(); continue; }
          break;
        }
      }
    } finally {
      this.flushing = false;
      this.persist();
    }
  }

  private persist() {
    this.deps.storage?.save(this.unsent);
    this.state = { ...this.state, unsent: this.unsent.length };
    this.listeners.forEach((fn) => fn());
  }
}

/** The server answered and said no (as opposed to not answering at all) */
const isRefusal = (err: unknown) => !!err && typeof err === "object" && (err as { refused?: boolean }).refused === true;
export const refusal = (message: string) => Object.assign(new Error(message), { refused: true });
