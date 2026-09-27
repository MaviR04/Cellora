# Right-to-erasure request, end to end (UC15, Sri Lanka PDPA s.16)

- **Captured:** 2026-09-27T20:06:41.839Z
- **Shows:** A throwaway customer browses anonymously, signs up, orders, and gets a support note. Erasure deletes their events (by the time-series metaField: customerId and linked anonymous ids, including the pre-signup session), session summaries and notes, revokes sessions and deletes the Redis cart, pseudonymises the order (kept for accounting) and the user record. It is idempotent: running it again changes nothing. The audit entry records the scope but no personal data.
- **Report section:** 9. Limitations & ethics: data protection (PDPA); 7. time-series deletes by metaField
- **Command:** `POST /api/admin/customers/6ab977505da69df73d912b62/erase {confirmEmail} as admin`

```text
what                  before    after
eventsByAnonymousId   5       → 0
eventsByCustomerId    5       → 0
sessionSummaries      2       → 0
sessionNotes          1       → 0
redisCart             1       → 0
redisSessions         1       → 0

erase response:   200 {"userId":"6ab977505da69df73d912b62","events":5,"sessionSummaries":2,"sessionNotes":1,"ordersPseudonymised":1,"redisKeys":1,"sessionsRevoked":1,"durationMs":52}
run again:        200 {"userId":"6ab977505da69df73d912b62","events":0,"sessionSummaries":0,"sessionNotes":0,"ordersPseudonymised":0,"redisKeys":0,"sessionsRevoked":0,"durationMs":16}
customer's old session, GET /auth/me: {"user":null}

# order before
{"orderNumber":"ORD-20260928-0079","contact":{"name":"Erasure Test Customer","email":"erasure-test-1790539599984@example.com","phone":"+94 77 123 4567"},"shippingAddress":{"line1":"7 Temple Road","line2":"Apt 3","city":"Kandy","postcode":"20000","country":"Sri Lanka"},"sessionId":"f62c55bd-f10d-4970-8dc2-6bd7126583cb","items":["1× PX9-128-P"],"total":24990000}
# order after (kept, pseudonymised)
{"orderNumber":"ORD-20260928-0079","contact":{"name":"Erased customer","email":"erased-6ab977505da69df73d912b62@erased.invalid"},"shippingAddress":{"line1":"[erased]","city":"Kandy","country":"Sri Lanka"},"sessionId":null,"items":["1× PX9-128-P"],"total":24990000}

# user before
{"name":"Erasure Test Customer","email":"erasure-test-1790539599984@example.com","status":"active","anonymousIds":["66587155-9b1b-449d-b68f-974537615adb"],"addresses":[],"passwordHash":"scrypt$…"}
# user after
{"name":"Erased customer","email":"erased-6ab977505da69df73d912b62@erased.invalid","status":"erased","anonymousIds":[],"addresses":[],"passwordHash":"erased"}

# audit_log entry
{"action":"customer_erased","actor":"Ayesha Admin","target":{"type":"user","id":"6ab977505da69df73d912b62"},"details":{"events":5,"sessionSummaries":2,"sessionNotes":1,"ordersPseudonymised":1,"redisKeys":1,"sessionsRevoked":1}}

Not covered (limitations): copies in the Redis stream until MAXLEN trims them, the replica set oplog,
and backups. Aggregate rollups (metrics_hourly, funnel_daily) hold counts only, no personal data.
```
