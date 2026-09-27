# Unit tests (node:test)

- **Captured:** 2026-09-27T20:13:06.173Z
- **Shows:** Pure-logic tests with no database: event schema validation (valid events accepted, spoofed server events and bad payloads rejected), PII masking, password hashing, live-counter minute keys.
- **Report section:** 10. Evaluation: testing
- **Command:** `npm test`

```text
✔ a valid add_to_cart event is accepted (4.1714ms)
✔ the browser can't send server-only events (order_placed) (0.1838ms)
✔ an unknown event type is rejected (0.1079ms)
✔ bad payloads are rejected: negative quantity, malformed product id, unknown kind (0.45ms)
✔ a batch holds 1–50 events (1.5465ms)
✔ minuteKey is the UTC minute as yyyyMMddHHmm (0.1477ms)
✔ emails keep only the first and last character of the local part (0.6001ms)
✔ phones show only the last four digits (0.1613ms)
✔ addresses keep city and country, hide street and postcode (0.517ms)
✔ orders are masked for support but not for admin (0.1577ms)
✔ passwords are salted scrypt hashes that verify only with the right password (172.2135ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1003.8466
```
