# Checkout race: 20 customers, 1 unit left

- **Captured:** 2026-09-27T18:30:52.964Z
- **Shows:** 20 concurrent POST /api/checkout requests, each for [45W charger, last 1TB iPhone 16 Pro Max]. Exactly one order is created, the phone is not oversold, and the losers' charger decrements are rolled back (charger stock drops by exactly 1).
- **Report section:** 6. Implementation: checkout transaction / 9. Strengths / 11. Evaluation
- **Command:** `20 x Promise.all(POST /api/checkout)`

```text
HTTP responses:       1 x 201, 19 x 409   (201 = order placed, 409 = sold out)
orders created:       1
phone (IP16PM-1T-DT) stock:  1 -> 0
charger (SMS-45W) stock:   108 -> 107   (only the winner's charger was sold)
server events queued: 1 x order_placed, 19 x checkout_failed(out_of_stock)
wall time:            353 ms for 20 checkouts
```
