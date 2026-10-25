# Bluetooth printing: what is known, what is not

Nothing here is built. The `bluetooth_ble` and `bluetooth_spp` transports are named in the registry and refuse to
send. Do not build one until a specific printer model is in hand and its protocol is verified on a real device.

## Two different Bluetooths

Thermal receipt printers use one of two Bluetooth kinds, and the difference decides everything:

- **Classic Bluetooth (SPP, "serial port")**. Most cheap "58 mm Bluetooth printers" are this kind. An Android phone
  pairs with one in system settings and apps talk to it as a serial port. **A web page cannot use it.** Web Bluetooth
  does not speak Classic. Reaching one from a browser needs a helper app on the device (for example an Android print
  service or a bridge app) that receives the job and writes it to the printer.
- **Bluetooth Low Energy (BLE, "GATT")**. What Web Bluetooth speaks. A BLE printer exposes a vendor-specific
  characteristic that accepts ESC/POS bytes. The service and characteristic UUIDs differ by manufacturer and
  sometimes by firmware, so there is no single protocol: each model has to be looked up and tested.

Many printers sold as "Bluetooth" are Classic only, some are BLE only, some are dual. A printer's brochure rarely says
which. Do not assume an ESC/POS Bluetooth printer works with Web Bluetooth.

## Browsers and devices

| Device | Web Bluetooth |
|---|---|
| Android, Chrome (also Samsung Internet, Opera) | Supported, over HTTPS, started by a tap. BLE only. |
| Windows, macOS, Linux, Chrome / Edge | Supported, BLE only. |
| iPhone and iPad (Safari, and Chrome, which uses Safari's engine) | **Not supported.** A third-party browser such as Bluefy adds it, which means staff install and use a different browser. |
| Firefox, desktop Safari | Not supported. |

These come from public browser-support pages that are undated. Check caniuse.com and MDN again at the time of building.

## Other facts to verify with a real printer before building

- Connecting needs the person to pick the printer in a browser prompt. Whether the browser lets a page reconnect to a
  paired printer later without asking again depends on the Chrome version and settings. Test it.
- BLE writes are small. Slips must be sent in chunks with a pause between them, and the right chunk size is per printer.
- ESC/POS text printing uses printer code pages that often lack the ₹ sign and Hindi. The reliable way is to draw the slip
  as an image (bitmap) and send that, which also keeps TableQR's own layout. That is more data over a slow link.
- A BLE printer accepts one connection at a time. Two phones cannot print to it together, so a shared printer used by
  several devices needs a network or cloud printer instead.
- BLE printers rarely report paper-out or cover-open. A Bluetooth transport can say `sent`, not `confirmed`, unless the
  model's status commands are verified to work.

## What to do when a printer is chosen

1. Get the exact model. Find out whether it is Classic, BLE or dual (the maker's spec sheet, or a BLE scanner app on the phone).
2. If it is BLE, find its service and characteristic UUIDs and ESC/POS or vendor command set from the maker, and
   confirm them with a scanner app before writing code.
3. If it is Classic only, choose a helper app or a different printer; do not try to make Web Bluetooth work.
4. Build the transport behind the existing interface (see printing-architecture.md), test it on the real printer and the
   real phone, and only then enable it in Settings.

## Sources

- [Browser support for Web Bluetooth (beaconzone, undated)](https://www.beaconzone.co.uk/blog/browser-support-for-web-bluetooth/)
- [Bluefy, a Web BLE browser for iOS (App Store)](https://apps.apple.com/app/id1492822055)
- [Forum report: two Bluetooth thermal printers that would not print from Chrome on Android, native app used instead](https://odoo.com/forum/help-1/bluetooth-thermal-printer-for-android-116961)
