# Server events in the Redis Stream

- **Captured:** 2026-09-27T18:30:53.115Z
- **Shows:** Trusted events (order_placed, checkout_failed) are appended by the API to the events:ingest stream with XADD, capped with MAXLEN ~ 100000. The ingest worker (Phase 5) moves them into MongoDB.
- **Report section:** 6. Implementation: telemetry ingestion
- **Command:** `XLEN events:ingest; XREVRANGE events:ingest + - COUNT 3`

```text
XLEN events:ingest = 4

1790533853108-0
{
  "eventId": "8c85c674-8a47-47c4-93b2-db802f2d1586",
  "ts": "2026-09-27T18:30:53.109Z",
  "type": "order_placed",
  "props": {
    "orderId": "6ab960ddec8db2e9cf3bf204",
    "orderNumber": "ORD-20260928-0040",
    "total": 38090000,
    "itemCount": 3
  },
  "source": "server",
  "meta": {
    "anonymousId": "81cf449e-1c06-4b79-bbca-75505927420a",
    "sessionId": "a7a47088-d6cb-4f3a-9435-0ba2edfa2813",
    "customerId": "6ab90f2b8645c10109a7df56"
  },
  "receivedAt": "2026-09-27T18:30:53.109Z"
}
1790533819334-0
{
  "eventId": "8710da7d-367f-4af3-aa58-708c1d0162f9",
  "ts": "2026-09-27T18:30:19.334Z",
  "type": "order_placed",
  "props": {
    "orderId": "6ab960bbec8db2e9cf3bf202",
    "orderNumber": "ORD-20260928-0021",
    "total": 38090000,
    "itemCount": 3
  },
  "source": "server",
  "meta": {
    "anonymousId": "8835bcc8-9f06-423d-9d2a-5a113b7daf93",
    "sessionId": "61031dac-9a89-439f-8f2c-34878e943c7d",
    "customerId": "6ab90f2b8645c10109a7df56"
  },
  "receivedAt": "2026-09-27T18:30:19.334Z"
}
1790533640140-0
{
  "eventId": "714b8fe4-bb00-4e3e-9f0d-810dccf1ee52",
  "ts": "2026-09-27T18:27:20.139Z",
  "type": "order_placed",
  "props": {
    "orderId": "6ab960081ba3f790714e5b0a",
    "orderNumber": "ORD-20260927-0001",
    "total": 1350000,
    "itemCount": 2
  },
  "source": "server",
  "meta": {
    "anonymousId": "8f009f77-d6fb-4f0b-9df3-39e9024cbe55",
    "sessionId": "1786fbc5-cf62-4722-aae8-56ed07732637",
    "customerId": null
  },
  "receivedAt": "2026-09-27T18:27:20.140Z"
}
```
