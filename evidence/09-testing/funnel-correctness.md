# Funnel pipeline correctness on a hand-made dataset

- **Captured:** 2026-09-27T20:13:05.087Z
- **Shows:** Ten sessions with known answers, including the awkward cases (steps out of order, duplicates, a skipped step, an order without a view, a session crossing local midnight, non-funnel events), run through the same funnelPipeline() the worker uses. Every day and device matches the hand-worked result. A naive count per event type would report 50% conversion instead of 17%.
- **Report section:** 10. Evaluation: testing
- **Command:** `funnelPipeline() over a temporary collection, compared with hand-worked expectations`

```text
# the dataset
A  desktop  all four steps in order                                        product_view@01-10 10:00, add_to_cart@01-10 10:05, checkout_started@01-10 10:10, order_placed@01-10 10:12
B  desktop  view → cart, then leaves                                       product_view@01-10 11:00, add_to_cart@01-10 11:03
C  mobile   cart BEFORE view (e.g. re-order link): only the view counts    add_to_cart@01-10 12:00, product_view@01-10 12:05
D  mobile   order with no product view: not in the funnel at all           order_placed@01-10 12:30
E  mobile   duplicates (2 views, 2 carts) counted once                     product_view@01-10 13:00, product_view@01-10 13:01, add_to_cart@01-10 13:02, add_to_cart@01-10 13:03, checkout_started@01-10 13:05
F  tablet   skips the cart: checkout and order don't count                 product_view@01-10 14:00, checkout_started@01-10 14:02, order_placed@01-10 14:04
G  mobile   crosses local midnight: counted on the day it started          product_view@01-10 23:50, add_to_cart@01-11 00:10
H  desktop  all four steps, day 2                                          product_view@01-11 09:00, add_to_cart@01-11 09:02, checkout_started@01-11 09:04, order_placed@01-11 09:06
I  desktop  only page views and a search: ignored                          page_view@01-11 10:00, search@01-11 10:01
J  desktop  checkout BEFORE cart: stops after the cart step                product_view@01-11 11:00, checkout_started@01-11 11:01, add_to_cart@01-11 11:02, order_placed@01-11 11:03

# expected (by hand) vs pipeline                     [view, cart, checkout, order]
2026-01-10 all devices         expected [6,4,2,1]      got [6,4,2,1]      PASS
2026-01-10 desktop             expected [2,2,1,1]      got [2,2,1,1]      PASS
2026-01-10 mobile              expected [3,2,1,0]      got [3,2,1,0]      PASS
2026-01-10 tablet              expected [1,0,0,0]      got [1,0,0,0]      PASS
2026-01-11 all devices         expected [2,2,1,1]      got [2,2,1,1]      PASS
2026-01-11 desktop             expected [2,2,1,1]      got [2,2,1,1]      PASS

# why order matters (2026-01-10)
naive distinct sessions per event type: [6,4,3,3] → "conversion" 50%
ordered funnel (the pipeline):          [6,4,2,1] → conversion 17%

RESULT: all checks PASS
```
