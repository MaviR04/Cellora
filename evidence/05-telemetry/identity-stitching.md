# Identity stitching after login

- **Captured:** 2026-09-27T18:41:15.143Z
- **Shows:** Events recorded while the shopper was anonymous were updated with their customerId when the identify event was ingested (updateMany on the time-series metaField), so the customer's full history includes pre-login browsing.
- **Report section:** 5. Data model: identity stitching
- **Command:** `db.events.countDocuments({ "meta.anonymousId": "0a247849-c30b-4df7-894e-16caa50fad06", "meta.customerId": null })`

```text
events before login in this session:                 12
  of which now linked to the customer (customerId):  12
events for this browser still anonymous:             0
customerId on order_placed:                          6ab90f2b8645c10109a7df56
```
