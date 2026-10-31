# Printing on a receipt roll

Tableeqr prints through the browser: it builds a small HTML page for the slip, sets the page size
with `@page`, and calls the browser's print. There is no ESC/POS or printer driver in the app, so
the printer must be set up in the operating system and chosen in the browser's print window.

## The slips

| Slip | Built by | Printed from |
|---|---|---|
| Customer bill / receipt | `src/app/pos/_components/bill-print.ts` | POS billing, Floor |
| Kitchen order ticket (KOT) | `src/app/(staff)/kds/_components/kot-print.ts` | Kitchen screen, auto-print |
| Order slip (with total) | `src/app/(console)/console/(app)/orders/_components/order-slip-print.ts` | Orders |
| Day summary / day close | `src/app/(console)/console/(app)/reports/day-close/_components/day-close-print.ts` | Reports > Day close |

Each has its own layout. They share `src/lib/print/thermal.ts` (paper sizes, printable width,
type sizes, the `@page` rule) and `src/lib/print/runtime.ts` (paper setting, fitting the page
height, opening the print window).

## Direct printing from a Windows counter computer

For a USB thermal printer, install and run [QZ Tray](https://qz.io/download/) on the same Windows
computer that Tableeqr is open on. In Settings > Printers, select **Direct print (QZ Tray)**, use **Find
printers**, choose the Windows printer name, and save it. The outlet stores the printer and roll
width; the Windows printer-name mapping stays on that device, separately for each outlet. Other
terminals with no local mapping fall back to browser print. The bridge measures the slip in the
browser and asks QZ Tray to print with that receipt's width and height. This skips Chrome's print
dialog and its headers and footers; the Windows driver must accept custom receipt page sizes.

QZ Tray may ask the user to allow Tableeqr to connect. Tableeqr does not contain a signing private
key; QZ Tray requires signed messages to suppress its security prompts. The app records a direct
print as **Sent** because a Windows print queue cannot confirm that paper came out. Keep Browser
print available as a fallback on devices without QZ Tray.

QZ Tray's HTML printing goes through the installed Windows printer driver. If it still forces a
fixed page length, update the POS-80 driver or set a continuous/custom roll size in Windows printer
preferences.

## Paper

A device remembers its roll (80 mm or 58 mm) in the browser. A roll prints less than its full
width, and the printer centres that strip, so the text is laid out in a strip a little narrower
than the printable width: 70 mm on an 80 mm roll, 46 mm on a 58 mm roll. The 58 mm layout is its
own, with smaller type, not the 80 mm slip scaled down.

The page is as wide as the roll and as tall as the slip, measured just before printing, and always
taller than wide: a page wider than it is tall is printed sideways.

## Print window settings

The page asks for no margins, but the browser's print window has the last word. For a clean slip:

- Headers and footers: **off** (otherwise the date, title, web address and page number print)
- Margins: **None**
- Scale: **100%**
- Paper size: the roll's size, or the printer's own roll setting
- Destination: the receipt printer (or Save as PDF to check the layout)

Also check, in the printer's own settings, that the roll width matches and that any top margin or
"feed to label" option suits the paper. Preprinted label paper (for example a green vegetarian
mark) prints that mark from the paper itself; the app cannot remove it.

## Checking a layout

`npx tsx scripts/print-previews.ts [folder]` writes sample slips for both widths. Open one in
Chrome and print-preview at 100% scale. `test/print-layout.test.ts` checks every slip on both
widths for portrait pages, the printable strip, amounts that never wrap and the matching totals.
