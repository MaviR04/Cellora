# Dashboard API access by role

- **Captured:** 2026-09-27T19:33:15.124Z
- **Shows:** Analyst endpoints admit analyst+admin, support endpoints support+admin, admin endpoints admin only. 401 = not logged in, 403 = wrong role. Enforced by requireRole() on the API, not just by hiding links.
- **Report section:** 6. Implementation: role-based access (UC4)
- **Command:** `GET each endpoint as each demo account`

```text
GET endpoint                              anonymous  customer   analyst    support    admin      
/analytics/live                           401        403        200        403        200        
/analytics/funnel                         401        403        200        403        200        
/analytics/export?report=top&format=json  401        403        200        403        200        
/support/search?q=customer                401        403        403        200        200        
/support/failed-checkouts                 401        403        403        200        200        
/support/escalations                      401        403        403        200        200        
/admin/users                              401        403        403        403        200        
/admin/indexes                            401        403        403        403        200        
/admin/health                             401        403        403        403        200        
/admin/audit                              401        403        403        403        200
```
