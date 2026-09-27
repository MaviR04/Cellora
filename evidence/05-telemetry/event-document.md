# A stored telemetry event

- **Captured:** 2026-09-27T18:41:15.146Z
- **Shows:** Envelope (eventId, ts, type, source, page, device, receivedAt), identity in the metaField, and type-specific props with denormalised kind and price.
- **Report section:** 5. Data model: events
- **Command:** `db.events.findOne({ "meta.sessionId": "1b85cb54-2383-42ea-8aaf-79af19c5febc", type: "add_to_cart" })`

```json
{
  "ts": "2026-09-27T18:41:12.041Z",
  "meta": {
    "anonymousId": "0a247849-c30b-4df7-894e-16caa50fad06",
    "customerId": "6ab90f2b8645c10109a7df56",
    "sessionId": "1b85cb54-2383-42ea-8aaf-79af19c5febc"
  },
  "eventId": "77a6e82c-06eb-4b15-8f30-a038b9adfb22",
  "source": "client",
  "device": {
    "type": "desktop",
    "os": "Windows",
    "browser": "Edge"
  },
  "page": {
    "path": "/p/galaxy-s25-ultra"
  },
  "type": "add_to_cart",
  "receivedAt": "2026-09-27T18:41:12.270Z",
  "props": {
    "productId": "6ab907966a3a769b4bcccd1d",
    "sku": "GS25U-256-TS",
    "kind": "phone",
    "qty": 1,
    "unitPrice": 42990000
  }
}
```
