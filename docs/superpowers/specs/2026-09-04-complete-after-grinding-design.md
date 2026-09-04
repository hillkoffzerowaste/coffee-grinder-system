# Complete after grinding design

## Purpose

The grinding station finishes a bag when the operator presses `บดเสร็จ`. Packaging is no longer an operational workflow step. The counter station must show actionable queue status, and both stations must keep the five scanable grind barcodes visible above lower-priority data.

## Workflow and migration

New bag transitions are `QUEUED → CLAIMED → GRINDING → COMPLETED`. `GRINDING → COMPLETED` records both `ground_at` and `completed_at`, clears the claim, emits the normal bag-change event, and completes the parent order when every bag is terminal.

The migration updates every existing `GROUND` and `PACKING` bag to `COMPLETED`; it preserves the earlier job events, adds a `GROUND/PACKING → COMPLETED` event with a valid admin actor, sets `completed_at` if missing, clears active ownership, recalculates affected order status, emits change events, and writes an audit entry explaining the one-time workflow retirement. Historical status values remain permitted for old records, but the API and UI stop creating or presenting packaging transitions.

## Sales status

The orders endpoint exposes summary counts derived from bags: total bags, queued bags, active bags, completed bags, the oldest queued creation time, and the count of queued bags older than one minute. The counter monitor shows these values per open order and prominently marks an order when its older-than-one-minute count is nonzero. It displays the longest wait as whole minutes, updated with the existing two-second polling cycle.

## Packing alert and layout

The packing alarm remains active while the global queued-bag count is greater than zero. It repeats on its existing cadence after audio is enabled and stops only when the count reaches zero, including when the final queued bag is claimed. The on-screen queue summary explicitly states the remaining unclaimed bag count.

In both counter and packing workspaces, the barcode panel is the first operational content and uses the full available width. The five configured scanable grind barcodes appear in one non-scrolling responsive grid. Controls, selected product/status information, and the job table appear below it. The packing table retains queue, product, size, grind, bag/status, and action information but is no longer allowed to reduce the barcode panel's first-screen visibility.

## Error handling and tests

Polling failures keep the most recent status and show the existing connection warning. A missing or stale queue response must not stop an already-active alarm incorrectly.

Tests cover: direct `GRINDING → COMPLETED`; rejection of legacy new transitions; migration of both legacy statuses with audit/event/order completion; one-minute sales warning and wait display; alarm continuation until zero queued bags; and visible, non-disclosure barcode panels in both workspaces with queue details below.
