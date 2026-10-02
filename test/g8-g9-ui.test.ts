import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BillScreen, type BillPreview } from "@/app/(guest)/r/[outlet]/t/[table]/bill/_components/bill-screen";
import { PaidScreen, type PaidPreview } from "@/app/(guest)/r/[outlet]/t/[table]/paid/_components/paid-screen";
import { g8Base, g8Cases } from "@/app/dev/g8/_fixtures";
import { g9Base, g9Cases } from "@/app/dev/g9/_fixtures";
import type { BillScreenData } from "@/server/guest/bill-screen";
import type { AfterVisitData } from "@/server/guest/after-visit";

// G8 and G9 rendered to HTML: what is offered when, and what is never said.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/bill/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/paid/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/orders/actions", () => ({}));
vi.mock("@/app/(guest)/r/[outlet]/t/[table]/actions", () => ({ setLanguage() {} }));

const bill = (data: BillScreenData, preview?: BillPreview, lang: "en" | "hi" = "en") =>
  renderToStaticMarkup(createElement(BillScreen, { data, lang, shortCode: "k7Qm", realtimeUrl: null, preview }));
const paid = (data: AfterVisitData, preview?: PaidPreview) => renderToStaticMarkup(createElement(PaidScreen, { data, lang: "en", shortCode: "k7Qm", realtimeUrl: null, preview }));
const caseOf = (id: string) => g8Cases().find((c) => c.id === id)!;
const buttonWith = (html: string, text: string) => {
  const at = html.indexOf(text);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf(">", start) + 1);
};

describe("G8 bill", () => {
  it("before the bill is requested: read-only with Request bill, no split, tip or pay", () => {
    const html = bill(caseOf("before").data);
    expect(html).toContain("Request bill");
    expect(html).not.toMatch(/>Pay ₹/);
    expect(html).not.toContain("Tip (optional)");
    expect(html).not.toContain('role="radiogroup"');
  });

  it("after: the PS 3.6 breakdown with no hidden lines, and Pay ₹541", () => {
    const html = bill(g8Base);
    for (const text of ["₹390.00", "₹125.00", "₹515.00", "GST 5%", "₹25.75", "Round off", "₹0.25", "Pay ₹541", "Pay for someone else", "No tip", "5%", "10%", "Custom"]) expect(html).toContain(text);
    expect(html).not.toContain("INR");
  });

  it("shows the service charge as its own, removable line", () => {
    const html = bill(caseOf("sc-on").data);
    expect(html).toContain("Service charge (10%)");
    expect(html).toContain("Optional");
    expect(html).toContain(">Remove<");
  });

  it("never calls an unverified payment failed", () => {
    for (const state of ["verifying", "unknown"] as const) {
      const html = bill(g8Base, { pay: state });
      expect(html).toContain("Checking your payment");
      expect(html).toContain("Don&#x27;t pay again yet.");
      expect(html).not.toContain("did not go through");
      expect(buttonWith(html, "Pay ₹541")).toContain(' disabled=""');
    }
    expect(bill(g8Base, { pay: "failed" })).toContain("Payment did not go through");
    expect(bill(g8Base, { pay: "failed" })).not.toContain("No money was taken");
    expect(bill(g8Base, { pay: "cancelled" })).toContain("No money was taken.");
  });

  it("disables starting a payment while offline", () => {
    expect(buttonWith(bill(g8Base), "Pay ₹541")).not.toContain(' disabled=""');
    const offline = bill(g8Base, { offline: true });
    expect(offline).toContain("You’re offline");
    expect(buttonWith(offline, "Pay ₹541")).toContain(' disabled=""');
    expect(buttonWith(offline, "Pay for someone else")).toContain(' disabled=""');
  });

  it("locks the split for everyone once paying starts; only the host edits", () => {
    const locked = bill(caseOf("some-paid").data);
    expect(locked).toContain("The split is fixed now that someone has started paying.");
    expect(buttonWith(locked, ">Equal<")).toContain(' disabled=""');
  });

  it("custom is amount based: live allocated and remaining, Save only at exactly ₹0, read-only for guests", () => {
    const short = bill(caseOf("custom-remaining").data, caseOf("custom-remaining").preview);
    expect(short).toContain("Custom amounts");
    expect(short).toContain("₹2,080");
    expect(short).toMatch(/Remaining<\/dt><dd[^>]*>₹10</);
    expect(buttonWith(short, "Save amounts")).toContain(' disabled=""');
    const exactly = bill(caseOf("custom-edit").data, caseOf("custom-edit").preview);
    expect(exactly).toMatch(/Remaining<\/dt><dd[^>]*>₹0</);
    expect(buttonWith(exactly, "Save amounts")).not.toContain(' disabled=""');
    expect(bill(caseOf("custom-over").data, caseOf("custom-over").preview)).toMatch(/Over by<\/dt><dd[^>]*>₹20</);
    // No item assignment anywhere in Custom
    expect(exactly).not.toMatch(/Who had what|assign/i);

    const guest = bill(caseOf("custom-guest").data);
    expect(guest).toContain("Amounts set by Aarav.");
    expect(guest).not.toContain("Save amounts");
    expect(guest).not.toContain('inputMode="numeric" aria-label="Amount for');
    for (const amount of ["₹600", "₹450", "₹440"]) expect(guest).toContain(amount);
    const locked = bill(caseOf("custom-locked").data);
    expect(locked).toContain("The split is fixed now that someone has started paying.");
    expect(locked).not.toContain("Save amounts");
  });

  it("shows refund pending only from a real pending amount, and never says refunded", () => {
    expect(bill(caseOf("refund").data)).toContain("₹273 will be returned to the original payment method.");
    expect(bill(g8Base)).not.toContain("Refund pending");
    expect(bill(caseOf("refund").data)).not.toMatch(/Refunded/);
  });

  it("explains a reopened bill", () => {
    expect(bill(caseOf("reopened").data)).toContain("Your bill changed");
  });

  it("renders in Hindi without stand-in names", () => {
    const html = bill(g8Base, {}, "hi");
    expect(html).toContain("आपका हिस्सा");
    expect(html).not.toMatch(/Guest \d/);
  });
});

describe("G9 paid", () => {
  it("shows the same review link whatever the rating, and hides it when none is set", () => {
    for (const rating of [null, 1, 2, 5]) expect(paid({ ...g9Base, rating })).toContain("Leave a public review");
    expect(paid({ ...g9Base, reviewUrl: null })).not.toContain("Leave a public review");
  });

  it("offers only configured receipt channels, always the receipt itself", () => {
    const none = paid(g9Base);
    expect(none).not.toMatch(/WhatsApp|>SMS<|Email/);
    expect(none).toContain("View receipt");
    const some = paid(g9Cases().find((c) => c.id === "channels")!.data);
    expect(some).toContain("WhatsApp");
    expect(some).toContain("View invoice");
  });

  it("shows progress and who the table is waiting for, or that all is settled", () => {
    expect(paid(g9Base)).toContain("3 of 4 paid");
    expect(paid(g9Base)).toContain("Waiting for Chirag.");
    expect(paid(g9Cases().find((c) => c.id === "all-paid")!.data)).toContain("Thanks for dining with us.");
  });

  it("asks for a rating with optional feedback, then thanks for the feedback", () => {
    const g9 = (id: string) => g9Cases().find((c) => c.id === id)!;
    const fresh = paid(g9Base);
    expect(fresh).toContain("How was your meal?");
    expect(fresh.match(/role="radio"/g)).toHaveLength(5);
    expect(fresh).not.toContain(">Submit<");
    const picked = paid(g9("rating-picked").data, g9("rating-picked").preview);
    expect(picked).toContain("Tell us more (optional)");
    expect(picked).toContain(">Submit<");
    for (const id of ["high", "low"]) expect(paid(g9(id).data, g9(id).preview)).toContain("Thanks for your feedback.");
  });

  it("never says the receipt was sent unless delivery confirmed it, and labels the document honestly", () => {
    const g9 = (id: string) => g9Cases().find((c) => c.id === id)!;
    expect(paid(g9Base)).not.toContain("Receipt sent");
    expect(paid(g9("channels").data)).not.toContain("Receipt sent");
    expect(paid(g9("channels").data, g9("channels").preview)).toContain("Receipt sent to +9198xxxxxx10.");
    expect(paid(g9("receipt").data)).toContain("View final receipt");
    expect(paid(g9("receipt").data)).not.toContain("invoice");
  });

  it("after the table closes: no ordering navigation; later a read-only summary", () => {
    const g9 = (id: string) => g9Cases().find((c) => c.id === id)!;
    expect(paid(g9Base)).toContain('href="/r/SRJ01/t/k7Qm/menu"');
    const settled = paid(g9("all-paid").data);
    expect(settled).toContain("All settled");
    expect(settled).toContain("Table T12 is now closed.");
    expect(settled).not.toContain('href="/r/SRJ01/t/k7Qm/menu"');
    const later = paid(g9("read-only").data);
    expect(later).toContain("Your visit summary");
    expect(later).toContain("You can still view your receipt and rate your visit for 24 hours.");
    expect(later).toContain("You rated your meal 4 out of 5.");
    const expired = paid(g9("expired").data);
    expect(expired).not.toMatch(/₹|receipt|invoice/i);
  });

  it("does not offer booking until the booking flow is real, and ends access after 24 hours", () => {
    expect(paid(g9Base)).not.toContain("Book your next visit");
    expect(paid(g9Cases().find((c) => c.id === "expired")!.data)).toContain("This visit has ended.");
  });
});
