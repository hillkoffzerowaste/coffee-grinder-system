# Desktop operational layout regression checks

- Trigger: changes to fixed-height operational panels, flex sizing, scanner focus, or barcode layout.
- Action: run `npm run test:layout` and inspect the generated screenshots. Check entire barcode cards (including captions), nonzero table height, long Thai names, edit/add controls, packing claim/grind/complete, and scanner focus after actions. Unit tests alone cannot establish visibility.
- Evidence: at a 1707×710 viewport the previous composer collapsed its table to 0px and clipped barcode 15. A later 4px padding change clipped captions even while all SVGs remained visible.
- Scope: local, coffee grinder system. Validated 2026-09-04.

The layout runner uses real components with synthetic API responses and a local in-memory server, never production orders. It requires installed Chrome and the locked development dependencies. It checks 1366×768, 1707×710, and 1920×1080. Screenshots go to a temporary directory printed by the runner.

Expected behavior: original 176×88 barcode SVGs in three columns; all five cards visible initially at tested sizes; lower details/tables scroll without collapsing; the scanner remains sticky and refocus does not force a scroll jump; counter confirmation and packing action buttons remain accessible. Smaller/zoomed windows may require additional scrolling; do not claim every viewport fits without testing it.
