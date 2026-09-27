# Redis sessions and instant revocation

- **Captured:** 2026-09-27T12:49:17.750Z
- **Shows:** Sessions are Redis hashes with a TTL, indexed per user in a SET. An admin revoking a user's sessions deletes the keys, so the user is logged out on their very next request (a JWT could not be revoked before expiry). The action is written to audit_log.
- **Report section:** 6. Implementation: sessions (UC4) / 7. Characteristics: key-value store
- **Command:** `SMEMBERS user_sessions:<id>; HGETALL sess:<id>; POST /api/admin/users/:id/revoke-sessions`

```text
customer sessions (5):
  sess:ZBGw5J…064o  HASH  {userId: 6ab90f2b8645c10109a7df56, role: customer, email: customer@cellora.test}  TTL 604693s
  sess:Wf1GhC…Gn70  HASH  {userId: 6ab90f2b8645c10109a7df56, role: customer, email: customer@cellora.test}  TTL 604695s
  sess:k2161w…49sA  HASH  {userId: 6ab90f2b8645c10109a7df56, role: customer, email: customer@cellora.test}  TTL 604696s
  sess:tvZ4Gh…MOqM  HASH  {userId: 6ab90f2b8645c10109a7df56, role: customer, email: customer@cellora.test}  TTL 604800s
  sess:3YZ6JC…PxuA  HASH  {userId: 6ab90f2b8645c10109a7df56, role: customer, email: customer@cellora.test}  TTL 604800s

GET /api/auth/me as customer  -> customer@cellora.test
admin: POST revoke-sessions   -> 200 {"revoked":5}
GET /api/auth/me as customer  -> null   (same cookie, session no longer exists)
EXISTS user_sessions:6ab90f2b8645c10109a7df56 -> 0

audit_log: {"action":"sessions_revoked","actorRole":"admin","target":{"type":"user","id":"6ab90f2b8645c10109a7df56"},"details":{"email":"customer@cellora.test","revoked":5}}
```
