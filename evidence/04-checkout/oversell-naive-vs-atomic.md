# Overselling: read-then-write vs conditional update

- **Captured:** 2026-09-27T18:30:52.246Z
- **Shows:** 20 concurrent buyers, 1 unit in stock. The naive approach (read stock, then write stock-1) sells 18 units: a lost-update race. The single atomic conditional update ($elemMatch stock >= 1 + $inc) sells exactly 1.
- **Report section:** 7. Characteristics: atomic single-document operations / 9. Strengths
- **Command:** `Promise.all of 20 concurrent operations directly against MongoDB`

```text
# naive: find() the stock, check it in application code, then $set stock - 1
units sold: 18   stock after: 0   -> oversold by 17

# atomic: updateOne({ variants: { $elemMatch: { sku, stock: { $gte: 1 } } } }, { $inc: { 'variants.$.stock': -1 } })
units sold: 1   stock after: 0   -> correct

Why: MongoDB applies the filter and the update to a single document atomically, so only one
operation can observe stock >= 1. The naive version checks the stock in application code,
and every buyer reads the same value before anyone writes.
```
