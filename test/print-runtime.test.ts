import { afterEach, describe, expect, it, vi } from "vitest";
import { printHtml } from "@/lib/print/runtime";

// How a slip reaches the printer: a print someone asked for opens a window of its own, one nobody
// waits at (a kitchen ticket printing itself) and any print a pop-up blocker refuses use a hidden frame.

const html = "<!doctype html><html><head><style>@page{size:80mm 100mm;margin:0}</style></head><body><section data-slip>x</section></body></html>";

function fakeDocument() {
  const written: string[] = [];
  return {
    written,
    open: vi.fn(),
    write: (s: string) => written.push(s),
    close: vi.fn(),
    head: { innerHTML: "", appendChild: vi.fn() },
    body: { getBoundingClientRect: () => ({ height: 0, width: 0 }) },
    querySelectorAll: () => [],
    createElement: () => ({ textContent: "" }),
  };
}
function fakeWindow() {
  const doc = fakeDocument();
  return { doc, win: { document: doc, addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn(), close: vi.fn() } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("printing a slip", () => {
  it("opens a window of its own for a print someone asked for, and prints from it", () => {
    vi.useFakeTimers();
    const { win, doc } = fakeWindow();
    const open = vi.fn().mockReturnValue(win);
    vi.stubGlobal("window", { open });
    vi.stubGlobal("document", { createElement: vi.fn(), body: { appendChild: vi.fn() } });
    printHtml(html);
    expect(open).toHaveBeenCalledOnce();
    expect(doc.written[0]).toBe(html);
    vi.advanceTimersByTime(600);
    expect(win.print).toHaveBeenCalledOnce();
    // The window closes itself once the print dialog is done
    const afterPrint = win.addEventListener.mock.calls.find(([name]) => name === "afterprint")?.[1] as () => void;
    afterPrint();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it("prints a slip nobody is waiting at through a hidden frame, without opening a window", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const frameDoc = fakeDocument();
    const frame = { setAttribute: vi.fn(), style: {} as Record<string, string>, contentDocument: frameDoc, contentWindow: { focus: vi.fn(), print: vi.fn() }, remove: vi.fn(), onload: null as null | (() => void) };
    vi.stubGlobal("window", { open });
    vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(frame), body: { appendChild: vi.fn() } });
    printHtml(html, { background: true });
    expect(open).not.toHaveBeenCalled();
    expect(frameDoc.written[0]).toBe(html);
    vi.advanceTimersByTime(500);
    expect(frame.contentWindow.print).toHaveBeenCalledOnce();
  });

  it("falls back to the hidden frame when the browser blocks the window", () => {
    vi.useFakeTimers();
    const frameDoc = fakeDocument();
    const frame = { setAttribute: vi.fn(), style: {} as Record<string, string>, contentDocument: frameDoc, contentWindow: { focus: vi.fn(), print: vi.fn() }, remove: vi.fn(), onload: null as null | (() => void) };
    vi.stubGlobal("window", { open: vi.fn().mockReturnValue(null) });
    vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(frame), body: { appendChild: vi.fn() } });
    printHtml(html);
    vi.advanceTimersByTime(500);
    expect(frame.contentWindow.print).toHaveBeenCalledOnce();
  });
});
