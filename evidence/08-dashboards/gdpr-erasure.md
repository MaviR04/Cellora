# Right to erasure, end to end (UC15)

- **Captured:** 2026-09-27T19:33:21.281Z
- **Shows:** A throwaway customer browses anonymously, signs up, orders, and gets a support note. Erasure deletes their events (by the time-series metaField: customerId and linked anonymous ids, including the pre-signup session), session summaries and notes, revokes sessions and deletes the Redis cart, pseudonymises the order (kept for accounting) and the user record. It is idempotent: running it again changes nothing. The audit entry records the scope but no personal data.
- **Report section:** 9. Limitations & ethics: GDPR; 7. time-series deletes by metaField
- **Command:** `POST /api/admin/customers/6ab96f7f0b24ab06401b4bd9/erase {confirmEmail} as admin`

```text
what                  before    after
eventsByAnonymousId   5       → 0
eventsByCustomerId    5       → 0
sessionSummaries      2       → 0
sessionNotes          1       → 0
redisCart             1       → 0
redisSessions         1       → 0

erase response:   200 {"userId":"6ab96f7f0b24ab06401b4bd9","events":5,"sessionSummaries":2,"sessionNotes":1,"ordersPseudonymised":1,"redisKeys":1,"sessionsRevoked":1,"durationMs":51}
run again:        200 {"userId":"6ab96f7f0b24ab06401b4bd9","events":0,"sessionSummaries":0,"sessionNotes":0,"ordersPseudonymised":0,"redisKeys":0,"sessionsRevoked":0,"durationMs":15}
customer's old session, GET /auth/me: {"user":null}

# order before
{"orderNumber":"ORD-20260928-0054","contact":{"name":"Gdpr Test Customer","email":"gdpr-test-1790537599462@example.com","phone":"+94 77 123 4567"},"shippingAddress":{"line1":"7 Temple Road","line2":"Apt 3","city":"Kandy","postcode":"20000","country":"Sri Lanka"},"sessionId":"65a3d403-75e7-42c1-bc3c-bd3ca94e5145","items":["1× PX9-128-O"],"total":24990000}
# order after (kept, pseudonymised)
{"orderNumber":"ORD-20260928-0054","contact":{"name":"Erased customer","email":"erased-6ab96f7f0b24ab06401b4bd9@erased.invalid"},"shippingAddress":{"line1":"[erased]","city":"Kandy","country":"Sri Lanka"},"sessionId":null,"items":["1× PX9-128-O"],"total":24990000}

# user before
{"name":"Gdpr Test Customer","email":"gdpr-test-1790537599462@example.com","status":"active","anonymousIds":["805e2dd3-8932-45de-93df-c8bfb871b9d5"],"addresses":[],"passwordHash":"scrypt$…"}
# user after
{"name":"Erased customer","email":"erased-6ab96f7f0b24ab06401b4bd9@erased.invalid","status":"erased","anonymousIds":[],"addresses":[],"passwordHash":"erased"}

# audit_log entry
{"action":"customer_erased","actor":"Ayesha Admin","target":{"type":"user","id":"6ab96f7f0b24ab06401b4bd9"},"details":{"events":5,"sessionSummaries":2,"sessionNotes":1,"ordersPseudonymised":1,"redisKeys":1,"sessionsRevoked":1}}

Not covered (limitations): copies in the Redis stream until MAXLEN trims them, the replica set oplog,
and backups. Aggregate rollups (metrics_hourly, funnel_daily) hold counts only, no personal data.
```
