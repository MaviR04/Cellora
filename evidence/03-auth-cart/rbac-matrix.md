# Role-based access control matrix

- **Captured:** 2026-09-27T12:49:17.544Z
- **Shows:** HTTP status for each role on endpoints of increasing privilege: 401 = not logged in, 403 = logged in but wrong role, 200/404 = allowed through.
- **Report section:** 6. Implementation: access control (UC4)
- **Command:** `API requests as each demo account`

```text
endpoint                                  anonymous  customer   analyst    support    admin      
GET  /products (public)                   200        200        200        200        200        
GET  /auth/sessions (logged in)           401        200        200        200        200        
GET  /staff/me (any staff)                401        403        200        200        200        
POST /admin/.../revoke-sessions (admin)   401        403        403        403        404
```
