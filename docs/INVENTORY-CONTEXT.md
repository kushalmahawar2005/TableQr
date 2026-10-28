# Inventory management (context)

What Tableeqr's inventory does today, how it is built, and what is planned next. Written for the
owner and for anyone (or any AI agent) picking the work up. Built 27 Oct 2026, modelled on the
Petpooja inventory module. Not yet committed or deployed at the time of writing.

## In one line

Inventory keeps count of what the kitchen has (paneer, milk, eggs), what came in from suppliers,
what the dishes used, what was wasted, and what is left; and it tells the owner what is owed to
suppliers and what food costs as a share of sales.

## Who and where

- Screen: `/console/inventory` (sidebar: Inventory). Owners and managers only.
- Plans: only **Pro**, **Chain** and **Hotel + Restaurant** have it (`plans.features.inventory`).
  On Lite, Plus, Hotel and Custom the sidebar hides it and the page shows "Not in your plan".
- Everything is per outlet. Every query filters by `tenant_id` (checked by
  `test/isolation-guard.test.ts`).

## The screen: 8 tabs

| Tab | What the owner does there |
| --- | --- |
| **Stock** | The list of items with what is on hand, alert level, price per unit and value. Add or edit an item (name, unit, group, alert level, pack size, prep item). Quick buttons: Purchase, Wastage, Count. |
| **Purchases** | Every supplier bill and return. Click a bill to see its lines. Unpaid bills show "₹X due" with a Pay button. "Return to supplier" sends stock back. |
| **Suppliers** | Suppliers with bought, returned, paid and **due**. New bill, Pay, edit. Recent payments. |
| **Day-end count** | Type what is on the shelf at closing, for many items at once. Shows the difference live; on save shows the **variance** (shortfall/excess, in quantity and rupees). |
| **Recipes** | What one plate of each dish uses (e.g. Paneer Tikka = 0.2 kg paneer), with the cost per plate. A tick box: **"Sold out by itself when an ingredient runs out"**. |
| **Prep items** | Things made ahead from raw stock (makhani gravy, dough). Set what 1 unit takes; "Make batch" takes the ingredients out and puts the batch in. |
| **Report** | For a date range: per item opening, purchased, prep, sold, wastage, returned, variance, closing, cost of sold. Totals: **food cost %**, purchased, wastage, variance, stock value. Download as CSV (opens in Excel). |
| **History** | Every change to stock, newest first. |

Header buttons: **+ Stock item**, **New purchase bill**. Banners: running-low items, and dishes
that inventory has switched off because stock ran out.

## How stock moves

All quantities are stored as whole thousandths of the unit (1.5 kg = 1500) so nothing is lost to
rounding. Units: kg, g, litre, ml, pcs. Every change writes one row to `stock_moves`:

| Kind | When | Sign |
| --- | --- | --- |
| `purchase` | A supplier bill is saved (or the old single-item "Stock in") | + |
| `sale` | A bill is **paid**: each dish's recipe × plates sold | − |
| `wastage` | Someone records spoiled / burnt / spilled stock | − |
| `count` | A shelf count sets the real quantity; the move is the difference (the variance) | ± |
| `return` | Stock sent back to a supplier | − |
| `prep` | A prep batch: ingredients out (−), the prep item in (+) | ± |

- Sales come off only when the bill is paid, inside the bill's own transaction
  (`takeStockForBill`, called from `closeBill` in `src/server/billing/payments.ts`). A dish with no
  recipe takes nothing off. Open items typed at the POS have no dish, so they take nothing off.
- Stock may go below zero (sales outrunning the count); it shows in red.
- **Price per unit**: each purchase bill line sets the item's price to what that bill paid per
  unit. A prep batch's price is what its ingredients cost. Stock value and food cost use this
  latest price.

## Suppliers, bills and what is owed

- A **purchase bill** has a supplier (or "cash purchase", no supplier), bill no., date (not in
  the future), and up to 100 lines. Each line: item, quantity (by the unit, or by the pack, e.g.
  2 crates = 60 eggs), amount. Optional "paid now" + method (cash, UPI, bank, card, cheque).
- A **return** needs a supplier and cannot send back more than is in stock.
- **Due** for a supplier = bills − returns − payments. A negative due shows as an advance.
- Payments can be against one bill or towards the total.

## Day-end count and variance

The owner counts the shelf and types the numbers. For each counted item:
variance = counted − what the system expected. A shortfall means stock used without a bill,
wastage nobody wrote down, or a recipe that needs fixing. The count then becomes the new quantity.

## Dishes going sold out by stock

Off by default (`outlets.stock_sold_out`). When on:

- After any stock change, every dish whose recipe has an ingredient at or below zero is switched
  off (`outlet_item_overrides.is_available = false`, `sold_out_by_stock = true`).
- When all its ingredients are back above zero, inventory switches it back on.
- A dish someone switched off by hand is never switched on by inventory. Switching a dish on or
  off by hand (Menu screen) clears the inventory flag.
- Turning the setting off switches back on every dish inventory had switched off.
- Guests' phones get an `item.availability` realtime event. After a paid bill the event is sent
  about a second later, because the bill's transaction has no after-commit hook.

## Report maths

For a range of business days (the outlet's day cutoff, IST; at most 3 months):

- opening = closing − all moves in the range; closing = today's quantity − moves after the range
- sold = −sum of `sale` moves; cost of sold = sold × latest price
- **food cost %** = cost of sold ÷ food sales (paid bills' subtotal − discount) in the range
- Dishes without a recipe add nothing to cost of sold, so food cost is only as complete as the
  recipes.

## Code map

| Part | File |
| --- | --- |
| Tables | `src/db/schema/inventory.ts` (`stock_items`, `recipe_lines`, `stock_moves`, `suppliers`, `purchases`, `supplier_payments`, `prep_lines`); `outlets.stock_sold_out` in `tenancy.ts`; `outlet_item_overrides.sold_out_by_stock` in `menu.ts` |
| Migrations | `drizzle/0024_inventory.sql` (first version), `drizzle/0064_inventory_pro.sql` (this work) |
| Quantity helpers | `src/domain/inventory.ts` (`toMilli`, `showQty`, `usage`, `isLow`) |
| Items, recipes, single moves, sale deduction | `src/server/staff/inventory.ts` |
| Suppliers, bills, returns, payments, count, prep, sold-out sync, report | `src/server/staff/inventory-pro.ts` |
| Server actions | `src/app/(console)/console/(app)/inventory/actions.ts` |
| Screen | `src/app/(console)/console/(app)/inventory/_components/` — `inventory-screen.tsx` (shell, Stock, Recipes, History), `purchasing.tsx` (Purchases, Suppliers, bill/pay/supplier sheets), `count-prep-report.tsx` (Count, Prep, Report), `ui.tsx` (shared styles, sheet, CSV) |
| Tests | `test/integration/inventory.test.ts`, `test/integration/inventory-pro.test.ts` |

## Built alongside (same session)

- **POS terminal** (`/console/pos`, sidebar "POS"): table view → dishes by category with photos →
  order panel; **open item** (name + price typed in, `order_lines.item_id` is null, migration
  `0063_pos_open_items.sql`); Send KOT / KOT & bill. Files: `src/server/staff/pos-terminal.ts`,
  `src/app/(console)/console/(app)/pos/`. Test: `test/integration/pos-terminal.test.ts`.
- Cashiers could not add items or ask for the bill from Billing (role check fixed).
- Dark mode: plan banner buttons readable; floor table colours softer.

## Planned next (agreed with the owner, not built yet)

Most owners will not type recipes, so recipes become optional:

1. **No-recipe mode as the default**: "used" per item = opening + purchased − closing count,
   shown in the Report without any recipe. Tells the owner how much paneer went per day, not per
   dish.
2. **Bottled / packed items linked 1:1**: a tick on a stock item, "this is also a menu dish"
   (Coke, water bottle, ice cream). One sold = one off stock, no recipe.
3. **Recipes only for those who want per-dish detail**, optionally pre-filled with standard
   quantities from the dish library so the owner just approves or adjusts.
4. **Per-item ledger**: click an item to see only its moves (bought when, used by which bills,
   left now).

## Before deploying

- Run `npx tsc --noEmit` and `npm test`; `next build` type-checks tests too.
- Production needs migrations 0063 and 0064. On the local database, 0062 (`app_releases`) had
  been created without being recorded, which made `drizzle-kit migrate` stop silently. Check the
  live `__drizzle_migrations` the same way before pushing.
