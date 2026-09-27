# Catalog query plans (explain executionStats)

- **Captured:** 2026-09-27T12:17:19.088Z
- **Shows:** Each storefront query is served by the index designed for it (IXSCAN / TEXT_MATCH), examining only the matching documents; the forced collection scan reads every document for the same result.
- **Report section:** 5. Data model: indexing (ESR) / 9. Strengths
- **Command:** `db.products.find(...).sort(...).explain('executionStats')  vs  .hint({ $natural: 1 })`

```text
products in collection: 80

▶ Category listing: phones by price (UC8)
  filter: {"isActive":true,"kind":"phone"}  sort: {"basePrice":1}
  with index    FETCH <- IXSCAN                    index=kind_1_basePrice_1     keysExamined=17   docsExamined=17   returned=17   0ms
  forced COLLSCAN SORT <- COLLSCAN                   index=-                      keysExamined=0    docsExamined=80   returned=17   0ms

▶ Brand filter: Samsung products (UC8)
  filter: {"isActive":true,"brand":"Samsung"}
  with index    FETCH <- IXSCAN                    index=brand_1_kind_1         keysExamined=15   docsExamined=15   returned=15   0ms
  forced COLLSCAN COLLSCAN                           index=-                      keysExamined=0    docsExamined=80   returned=15   0ms

▶ Accessories for iPhone 16 Pro (UC8)
  filter: {"isActive":true,"compatibleModels":"apple-iphone-16-pro"}
  with index    FETCH <- IXSCAN                    index=compatibleModels_1     keysExamined=4    docsExamined=4    returned=4    0ms
  forced COLLSCAN COLLSCAN                           index=-                      keysExamined=0    docsExamined=80   returned=4    0ms

▶ Product page by slug (UC8)
  filter: {"slug":"iphone-16-pro","isActive":true}
  with index    FETCH <- IXSCAN                    index=slug_1                 keysExamined=1    docsExamined=1    returned=1    0ms
  forced COLLSCAN COLLSCAN                           index=-                      keysExamined=0    docsExamined=80   returned=1    0ms

▶ Text search: 'magsafe charger' (UC9)
  filter: {"$text":{"$search":"magsafe charger"},"isActive":true}  sort: {"score":{"$meta":"textScore"}}
  with index    PROJECTION_DEFAULT <- SORT <- FETCH <- TEXT_MATCH <- TEXT_OR <- IXSCAN <- IXSCAN index=product_text           keysExamined=12   docsExamined=22   returned=11   0ms
```
