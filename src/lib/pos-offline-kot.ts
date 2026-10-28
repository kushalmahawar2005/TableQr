import type { AnyDraftLine } from "@/server/guest/order";
import type { PosTerminal } from "@/server/staff/pos-terminal";
import { charsPerLine, clock, esc, profileFor, thermalDocument, wrapRows, type PaperMm } from "@/lib/print/thermal";
import type { OfflinePosOrder } from "./pos-offline-queue";

type Dish = PosTerminal["menu"][number];

/** A local paper copy for the kitchen when the cloud is unreachable. It is explicitly not a server KOT. */
export function offlinePosKotHtml(order: OfflinePosOrder, menu: Dish[], paper: PaperMm) {
  const profile = profileFor(paper);
  const perLine = charsPerLine(profile, profile.fsLarge + 1);
  const lines = order.lines.map((line: AnyDraftLine) => {
    if ("itemId" in line) {
      const dish = menu.find((item) => item.id === line.itemId);
      const modifiers = line.modifierIds.map((id) => dish?.pricing.groups.flatMap((group) => group.modifiers).find((mod) => mod.id === id)?.nameEn ?? id);
      return { name: dish?.name ?? line.itemId, qty: line.qty, modifiers, note: line.note ?? "", parcel: !!line.personalForPickup };
    }
    return { name: line.open.name, qty: line.qty, modifiers: [], note: line.note ?? "", parcel: !!line.personalForPickup };
  });
  const slip = `<div class="warning">OFFLINE COPY · NOT SENT TO KITCHEN</div>
<h1>${esc(order.current.takeaway ? "TAKEAWAY" : order.current.code)}</h1>
<div class="meta">Saved ${esc(clock(order.createdAt))} · ${order.partySize} guest${order.partySize === 1 ? "" : "s"}</div><hr>
${lines.map((line) => `<div class="item"><b>${line.qty}×</b><div><div class="name">${esc(line.name)}</div>${line.modifiers.map((mod) => `<div class="note">+ ${esc(mod)}</div>`).join("")}${line.parcel ? `<div class="note bold">PACK FOR TAKEAWAY</div>` : ""}${line.note ? `<div class="note bold">NOTE: ${esc(line.note)}</div>` : ""}</div></div>`).join("")}
<hr><div class="meta">Local recovery ID: ${esc(order.id.slice(0, 12))}</div>`;
  const rows = lines.reduce((total, line) => total + wrapRows(line.name, perLine - 4) + line.modifiers.reduce((count, mod) => count + wrapRows(`+ ${mod}`, perLine), 0) + (line.note ? wrapRows(`NOTE: ${line.note}`, perLine) : 0) + (line.parcel ? 1 : 0), 0);
  return thermalDocument({
    title: "Offline kitchen copy",
    paper,
    css: `.warning{text-align:center;border:2px solid #000;padding:4px 2px;font-weight:700;font-size:${profile.fs}px}.meta{text-align:center;font-size:${profile.fsSmall}px;margin:4px 0}hr{border-top:2px solid #000;margin:6px 0}.item{display:flex;gap:7px;margin:8px 0;align-items:flex-start}.item>b{font-size:${profile.fsLarge + 2}px;min-width:2.3em}.name{font-size:${profile.fsLarge + 1}px;font-weight:700;line-height:1.2}.note{font-size:${profile.fs}px;margin-top:2px}.bold{font-weight:700}h1{text-align:center;font-size:${profile.fsHuge}px;line-height:1.1}`,
    slips: [slip],
    estimateMm: 52 + rows * 9,
  });
}
