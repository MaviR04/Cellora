# Changing a role revokes the user's sessions immediately (UC4)

- **Captured:** 2026-09-27T20:06:37.364Z
- **Shows:** The role is copied into the Redis session hash at login, so an admin role change deletes the user's sessions: the old cookie stops working on the very next request, and the new login carries the new role. Both changes are in audit_log.
- **Report section:** 6. Implementation: user management (UC4); Redis sessions
- **Command:** `PATCH /api/admin/users/6ab965798645c10109a8321b {role} as admin`

```text
before:                         /auth/me role = customer
admin PATCH role -> support:    200 {"ok":true,"sessionsRevoked":2}
old cookie, GET /auth/me:       {"user":null}   (logged out)
new login, GET /staff/me:       200 role = support
admin PATCH role -> customer:   restored

audit_log:
  2026-09-27T20:06:37.355Z Ayesha Admin role_changed {"from":"support","to":"customer","sessionsRevoked":1}
  2026-09-27T20:06:37.281Z Ayesha Admin role_changed {"from":"customer","to":"support","sessionsRevoked":2}
```
