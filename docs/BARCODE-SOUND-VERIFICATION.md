# On-screen grind barcodes and sounds

- Counter, manual packing orders, and packing queue show Code 128 images for active grind values 6/8/10/12/15 using actual catalog barcode values. Other values remain available in the order dropdown. No product/grind identifiers are changed.
- Images have 10-module quiet zones, 2px modules for default codes, 72px bar height, and use the existing dark-text/white-surface colors. Independent ZXing decoding verifies all five codes, leading zeros, odd digit counts and a 32-digit value.
- Catalog failures are visible with a retry control, rather than silently hiding dropdown/barcode content.
- Click “เปิดเสียงแจ้งเตือน” once per mounted page. The same control then tests sound; mute is separate. Controls return focus to the scanner input. No browser autoplay override is used.
- Successful scans/commits play a short high tone; invalid scans/actions play two low tones. Packing polls every 5 seconds and plays a three-tone cue when the latest queue sequence increases. Initial loading and unchanged polling do not ring. The watermark is read across all bags, not only the 100 visible jobs.
- The open page must remain connected. Sleeping devices/background timer throttling or muted browser/OS speakers can delay/prevent sound. No web push or guaranteed background notification delivery is claimed.
- Physical scanner must support reading screens; otherwise use printed barcodes or the order dropdown. Hardware scanning and audible speaker output must be checked on site.

Verification: 31 automated tests; TypeScript, ESLint and production build. Chromium checks for all three pages at 375/768/1280px found zero document horizontal overflow and five visible barcode images; native AudioContext activation, error sounds, mute, and one-time new-job notification were verified. Temporary UI account was removed, with existing account credentials unchanged. Browser operational API responses were mocked; no orders were created by these tests.

References: [JsBarcode encoding API](https://github.com/lindell/JsBarcode), [Web Audio activation guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
