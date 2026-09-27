# PII masking for the Support role

- **Captured:** 2026-09-27T20:06:37.016Z
- **Shows:** Support agents get masked email, phone and street address (city kept for delivery questions); Admin sees the full record. Masking is applied in the API response, so unmasked data never reaches a support agent's browser.
- **Report section:** 9. Limitations & ethics: privacy / data minimisation
- **Command:** `GET /api/support/orders/ORD-20260928-0040 as support, then as admin; GET /api/support/search?q=customer@ as support`

```text
# as support
{
  "contact": {
    "name": "Kasun Perera",
    "email": "c***r@cellora.test",
    "phone": "••• ••• 4567"
  },
  "shippingAddress": {
    "line1": "••••••",
    "line2": "••••••",
    "city": "Colombo 03",
    "postcode": "•••••",
    "country": "Sri Lanka"
  }
}

# as admin
{
  "contact": {
    "name": "Kasun Perera",
    "email": "customer@cellora.test",
    "phone": "0771234567"
  },
  "shippingAddress": {
    "line1": "42 Galle Road",
    "line2": "Kollupitiya",
    "city": "Colombo 03",
    "postcode": "00300",
    "country": "Sri Lanka"
  }
}

# customer search as support
{"kind":"customer","label":"Kasun Perera","sublabel":"c***r@cellora.test · customer","customerId":"6ab90f2b8645c10109a7df56"}
```
