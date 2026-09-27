# Report export as CSV and JSON (UC3)

- **Captured:** 2026-09-27T19:33:15.455Z
- **Shows:** GET /api/analytics/export returns any report as a downloadable file (Content-Disposition: attachment). It uses the same cached computations as the dashboards.
- **Report section:** 6. Implementation: export (UC3)
- **Command:** `GET /api/analytics/export?report=funnel|top&format=csv · report=trends&format=json`

```text
# funnel CSV   text/csv; charset=utf-8   attachment; filename="cellora-funnel-2026-09-15-to-2026-09-28.csv"
day,product_view,add_to_cart,checkout_started,order_placed
2026-09-15,650,111,53,34
2026-09-16,577,97,33,24
2026-09-17,606,106,52,43
2026-09-18,609,110,55,43
2026-09-19,786,133,64,53
…

# top CSV   attachment; filename="cellora-top-2026-09-15-to-2026-09-28.csv"
section,name,kind,views,add_to_cart,cart_rate,count,avg_results
product,Pixel 9,phone,629,34,0.054,,
product,Galaxy S25 Ultra,phone,619,37,0.060,,
product,iPhone 16 Pro,phone,617,38,0.062,,
product,iPhone 16,phone,611,38,0.062,,
…

# trends JSON   attachment; filename="cellora-trends-2026-09-15-to-2026-09-28.json"
keys: from, to, types, hours, days; 313 hourly rows; first: {"hour":"2026-09-14T18:30:00.000Z","counts":{"product_view":9,"page_view":15,"category_view":3,"search":2},"sessions":5}
```
