# Order document (embedded snapshot)

- **Captured:** 2026-09-27T18:30:53.111Z
- **Shows:** Line items and the delivery address are embedded copies taken at checkout (name, variant, unit price), so the order stays correct even if the product is later renamed or repriced. customerId references the user; sessionId links the order to its telemetry.
- **Report section:** 5. Data model: embed vs reference (orders)
- **Command:** `db.orders.findOne({ orderNumber: "ORD-20260928-0040" })`

```json
{
  "_id": "6ab960ddec8db2e9cf3bf204",
  "orderNumber": "ORD-20260928-0040",
  "customerId": "6ab90f2b8645c10109a7df56",
  "contact": {
    "name": "Kasun Perera",
    "email": "customer@cellora.test",
    "phone": "0771234567"
  },
  "sessionId": "a7a47088-d6cb-4f3a-9435-0ba2edfa2813",
  "anonymousId": "81cf449e-1c06-4b79-bbca-75505927420a",
  "items": [
    {
      "productId": "6ab907966a3a769b4bcccd46",
      "sku": "GGL-45W",
      "kind": "charging",
      "name": "45W USB-C Charger",
      "brand": "Google",
      "variantLabel": "Standard",
      "unitPrice": 1150000,
      "qty": 1,
      "lineTotal": 1150000
    },
    {
      "productId": "6ab907966a3a769b4bcccd22",
      "sku": "PX9P-256-O",
      "kind": "phone",
      "name": "Pixel 9 Pro",
      "brand": "Google",
      "variantLabel": "256GB Obsidian",
      "unitPrice": 35990000,
      "qty": 1,
      "lineTotal": 35990000
    },
    {
      "productId": "6ab907966a3a769b4bcccd34",
      "sku": "SPTA-PIXEL9PRO-B",
      "kind": "case",
      "name": "Tough Armor for Pixel 9 Pro",
      "brand": "Spigen",
      "variantLabel": "Black",
      "unitPrice": 950000,
      "qty": 1,
      "lineTotal": 950000
    }
  ],
  "totals": {
    "subtotal": 38090000,
    "shipping": 0,
    "total": 38090000
  },
  "shippingAddress": {
    "line1": "42 Galle Road",
    "line2": "Kollupitiya",
    "city": "Colombo 03",
    "postcode": "00300",
    "country": "Sri Lanka"
  },
  "payment": {
    "method": "card",
    "status": "paid"
  },
  "status": "paid",
  "statusHistory": [
    {
      "status": "paid",
      "at": "2026-09-27T18:30:53.092Z"
    }
  ],
  "createdAt": "2026-09-27T18:30:53.099Z",
  "updatedAt": "2026-09-27T18:30:53.099Z"
}
```
