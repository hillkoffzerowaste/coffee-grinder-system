# On-screen grind barcodes and sounds

- Counter, manual packing orders, and packing queue show Code 128 images for active grind values 6/8/10/12/15 using actual catalog barcode values. Other values remain available in the order dropdown. No product/grind identifiers are changed.
- Images have 10-module quiet zones, 2px modules for default codes, 72px bar height, and use the existing dark-text/white-surface colors. Independent ZXing decoding verifies all five codes, leading zeros, odd digit counts and a 32-digit value.
- Catalog failures are visible with a retry control, rather than silently hiding dropdown/barcode content.
- Click “เปิดเสียงแจ้งเตือน” once per mounted page. The same control then tests sound; mute is separate. Controls return focus to the scanner input. No browser autoplay override is used.
- Successful scans/commits play a short high tone; invalid scans/actions play two low tones. Packing polls every 5 seconds and repeats a three-tone cue every 3 seconds while any bags remain QUEUED. Enabling sound after work arrives also starts the alarm. The alarm stops when all queued bags are claimed, when muted, or when leaving the page. The pending count covers all bags, not only the 100 visible jobs or the current filter. Taking one bag does not silence other unclaimed bags. Stale responses are ignored so they cannot restart a cleared alarm.
- The open page must remain connected. Sleeping devices/background timer throttling or muted browser/OS speakers can delay/prevent sound. No web push or guaranteed background notification delivery is claimed.
- Physical scanner must support reading screens; otherwise use printed barcodes or the order dropdown. Hardware scanning and audible speaker output must be checked on site.

Verification: 32 automated tests; TypeScript, ESLint and production build. Chromium checks cover all three pages at 375/768/1280px, five visible barcode images, native AudioContext activation, error sounds and mute. The notification test now requires repeated sound, partial claims keeping the alarm active, and a fully claimed queue stopping it. Temporary UI accounts are removed, with existing credentials unchanged. Browser operational API responses are mocked; no orders are created by these tests.

## Local verification lesson — candidate, 2026-09-04

When an operational alarm is requested, test its entire lifetime: pending work before enabling sound, repeated alerts, partial acknowledgement, full acknowledgement, mute and navigation cleanup. A single successful tone is not evidence of an acknowledgement-driven alarm. Evidence: user clarified that packing must keep sounding until work is accepted; the prior arrival-only implementation and test did not meet that requirement. Recorded locally as a candidate, not promoted to global instructions.

References: [JsBarcode encoding API](https://github.com/lindell/JsBarcode), [Web Audio activation guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
