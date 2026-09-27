# Event, device and search breakdowns

- **Captured:** 2026-09-27T18:55:46.767Z
- **Shows:** The mix of event types, the device split (mobile-first), top searches, and zero-result searches (a catalog-gap signal). Also shows a limitation of $text search: term-OR matching.
- **Report section:** 8. Applications: behavioural analytics / 10. Limitations: text search
- **Command:** `db.events.aggregate([$group by type / by session device / by search query])`

```text
events by type:
  page_view            50312
  product_view         26260
  category_view        14896
  search                3405
  add_to_cart           1733
  checkout_started       796
  payment_submitted      659
  order_placed           609
  identify               498
  checkout_failed         54
  remove_from_cart        11

sessions by device:
  mobile       8015  (62%)
  desktop      4160  (32%)
  tablet        804  (6%)

top searches (query, times searched, results):
  iphone 16                    474   25
  galaxy s25                   417   19
  magsafe charger              283   11
  airpods                      276   3
  fast charger                 231   10
  pixel 9                      215   12
  screen protector iphone      197   27
  s25 ultra case               196   24
  power bank                   192   7
  smart watch                  149   7
  usb c cable                  143   8
  iphone 17                    139   25

zero-result searches (catalog gaps):
  tripod                        45

Note: "iphone 17" is not zero-result: $text matches ANY term, so "iphone" alone returns every
iPhone product. MongoDB text indexes have no phrase-level relevance tuning or typo tolerance;
a dedicated search engine (Atlas Search / Elasticsearch) would be needed for that.
```
