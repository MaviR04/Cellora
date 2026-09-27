# Customer document

- **Captured:** 2026-09-27T12:49:17.755Z
- **Shows:** A customer in `users`: scrypt password hash with a per-user salt, and the anonymous browser IDs linked at login (identity stitching, bounded to 20 with $push/$slice).
- **Report section:** 5. Data model: users
- **Command:** `db.users.findOne({ email: "customer@cellora.test" })`

```json
{
  "_id": "6ab90f2b8645c10109a7df56",
  "email": "customer@cellora.test",
  "__v": 0,
  "addresses": [],
  "anonymousIds": [
    "1872c693-7a6c-4056-a975-7c90cbc17737",
    "292e2291-0ef7-4e5e-8d40-28db3644135c"
  ],
  "createdAt": "2026-09-27T12:42:19.430Z",
  "name": "Kasun Perera",
  "passwordHash": "scrypt$Q5C+4/q1Tsz0Q… (scrypt, per-user salt)",
  "role": "customer",
  "status": "active",
  "updatedAt": "2026-09-27T12:49:17.628Z",
  "lastLoginAt": "2026-09-27T12:49:17.620Z"
}
```
