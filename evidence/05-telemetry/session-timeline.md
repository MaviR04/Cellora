# One shopper session, reconstructed from the events collection

- **Captured:** 2026-09-27T18:41:15.136Z
- **Shows:** Every step of a real browser session (page views, product views, search, add to cart, login, checkout, order) captured by the tracker, sent through the Redis Stream and stored in the time-series collection, queried by meta.sessionId.
- **Report section:** 6. Implementation: telemetry pipeline / UC12 session timeline
- **Command:** `db.events.find({ "meta.sessionId": "1b85cb54-2383-42ea-8aaf-79af19c5febc" }).sort({ ts: 1 })`

```text
session 1b85cb54-2383-42ea-8aaf-79af19c5febc   anonymousId 0a247849-c30b-4df7-894e-16caa50fad06

   +time  source  customer  type                event
   +0.0s  client  yes       page_view           /
   +0.6s  client  yes       category_view       kind=phone
   +0.6s  client  yes       page_view           /c/phone
   +0.8s  client  yes       page_view           /p/galaxy-s25-ultra
   +0.8s  client  yes       product_view        /p/galaxy-s25-ultra  (phone, from 429900 LKR)
   +0.8s  client  yes       add_to_cart         GS25U-256-TS x1 @ 429900 LKR
   +0.9s  client  yes       page_view           /search?q=s25%20ultra%20case
   +0.9s  client  yes       search              "s25 ultra case" -> 24 results
   +1.0s  client  yes       page_view           /p/spigen-ultra-hybrid-magfit-galaxy-s25-ultra
   +1.0s  client  yes       product_view        /p/spigen-ultra-hybrid-magfit-galaxy-s25-ultra  (case, from 8500 LKR)
   +1.0s  client  yes       add_to_cart         SPUH-GALAXYS25ULTRA-C x1 @ 8500 LKR
   +1.2s  client  yes       page_view           /login?next=/checkout
   +1.9s  client  yes       identify            customerId=6ab90f2b8645c10109a7df56 via login
   +1.9s  client  yes       checkout_started    2 items, 438400 LKR
   +1.9s  client  yes       page_view           /checkout
   +2.1s  client  yes       payment_submitted   method=cod
   +2.1s  server  yes       order_placed        ORD-20260928-0041, total 438400 LKR
   +2.1s  client  yes       page_view           /orders/ORD-20260928-0041?placed=1

18 events; device: {"type":"desktop","os":"Windows","browser":"Edge"}
```
